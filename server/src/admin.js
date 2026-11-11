import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config, paths } from './config.js'
import { Store, generateCode, normalizeCode } from './store.js'
import { makeAdminToken, verifyAdminSignature } from './session.js'
import { THEMES } from './themes.js'
import { fetchPlaylist } from './ytmusic.js'
import { mapLimit, rankCandidates, selectPlaylistIds } from './match.js'
import * as jellyfin from './jellyfin-admin.js'
import { blockedGuard, createLimiter } from './ratelimit.js'

const loginLimiter = createLimiter({ windowMs: config.loginWindowMs, max: config.loginMaxFailures })

const ASSET_SLOTS = ['logo', 'logoDark', 'icon', 'loginBackground', 'albumPlaceholder', 'artistPlaceholder']
const MAX_ASSET_BYTES = { default: 4 * 1024 * 1024, loginBackground: 12 * 1024 * 1024 }

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, paths.tmp),
        filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '').toLowerCase()}`),
    }),
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok = /image\/(png|jpeg|webp|svg\+xml|avif|gif)/.test(file.mimetype)
        cb(ok ? null : new Error('Formato no soportado'), ok)
    },
})

/**
 * The admin token can travel in the cookie (normal browsers) or in an
 * Authorization header, so the panel also works where third-party/strict
 * cookie policies block the cookie (sandboxed previews, some embeds).
 */
const readAdminToken = req => {
    const header = req.headers.authorization || ''
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
    return req.cookies?.aurora_admin
}

const requireAdmin = (req, res, next) => {
    const session = verifyAdminSignature(readAdminToken(req))
    if (!session) return res.status(401).json({ error: 'unauthorized' })
    next()
}

const assetUrl = (slot, version) => (Store.assets[slot] ? `/branding/${slot}?v=${version}` : null)

export const publicBranding = () => {
    const settings = Store.settings
    return {
        brandName: settings.brandName || 'Aurora Music',
        defaultTheme: settings.defaultTheme,
        defaultLanguage: settings.defaultLanguage,
        codeFieldLabel: settings.codeFieldLabel,
        codeFieldPlaceholder: settings.codeFieldPlaceholder,
        hideAbout: Boolean(settings.hideAbout),
        assets: {
            logo: assetUrl('logo', '1'),
            logoDark: assetUrl('logoDark', '1'),
            icon: assetUrl('icon', '1'),
            loginBackground: assetUrl('loginBackground', '1'),
            albumPlaceholder: assetUrl('albumPlaceholder', '1'),
            artistPlaceholder: assetUrl('artistPlaceholder', '1'),
        },
        playerType: 'Aurora',
    }
}

export const createAdminRouter = () => {
    const router = express.Router()

    // ---------- auth ----------
    router.post(
        '/api/login',
        blockedGuard(loginLimiter, 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.'),
        express.json(),
        (req, res) => {
        const { username, password } = req.body || {}
        if (!Store.hasAdmin) {
            return res.status(409).json({ error: 'no_admin', message: 'Configura ADMIN_PASSWORD en el entorno.' })
        }
        if (!Store.verifyAdmin(String(username || ''), String(password || ''))) {
            loginLimiter.fail(req.ip)
            return res.status(401).json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' })
        }
        loginLimiter.clear(req.ip)
        const token = makeAdminToken()
        res.cookie('aurora_admin', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
            maxAge: 1000 * 60 * 60 * 12,
            path: '/',
        })
        // The panel stores this token and sends it as a Bearer header
        res.json({ ok: true, token })
    })

    router.post('/api/logout', (_req, res) => {
        res.clearCookie('aurora_admin', { path: '/' })
        res.json({ ok: true })
    })

    router.get('/api/me', (req, res) => {
        const session = verifyAdminSignature(readAdminToken(req))
        res.json({ authenticated: Boolean(session), configured: Store.hasAdmin })
    })

    router.use(requireAdmin)

    // ---------- upstream account (used by the importer) ----------
    router.post('/api/jellyfin/login', express.json(), async (req, res) => {
        const { serverId, username, password } = req.body || {}
        const server = Store.findById(serverId)
        if (!server) return res.status(404).json({ error: 'not_found', message: 'Servidor no encontrado.' })
        try {
            const session = await jellyfin.authenticateAdmin(server.jellyfinUrl, username, password || '')
            res.json({ ok: true, username: session.username })
        } catch (error) {
            res.status(401).json({ error: 'auth_failed', message: error.message })
        }
    })

    router.get('/api/jellyfin/status/:id', (req, res) => {
        const server = Store.findById(req.params.id)
        if (!server) return res.status(404).json({ error: 'not_found' })
        const session = jellyfin.getAdminSession(server.jellyfinUrl)
        res.json({ connected: Boolean(session) || Boolean(server.apiKey), username: session?.username || null, viaApiKey: Boolean(server.apiKey) })
    })

    // ---------- state ----------
    router.get('/api/state', (_req, res) => {
        res.json({
            settings: Store.settings,
            servers: Store.servers,
            assets: Store.assets,
            themes: THEMES.map(({ id, name, swatch }) => ({ id, name, swatch })),
            imports: Store.listImports().map(({ id, title, sourceUrl, createdAt, tracks, applied }) => ({
                id,
                title,
                sourceUrl,
                createdAt,
                applied: applied ? { at: applied.at, count: applied.count } : null,
                total: tracks.length,
                matched: tracks.filter(t => t.status === 'auto').length,
                review: tracks.filter(t => t.status === 'review').length,
                missing: tracks.filter(t => t.status === 'none').length,
            })),
        })
    })

    router.put('/api/settings', express.json(), (req, res) => {
        const allowed = [
            'brandName',
            'defaultTheme',
            'defaultLanguage',
            'codeFieldLabel',
            'codeFieldPlaceholder',
            'hideAbout',
        ]
        const patch = {}
        for (const key of allowed) if (key in (req.body || {})) patch[key] = req.body[key]
        res.json(Store.updateSettings(patch))
    })

    // ---------- servers ----------
    router.post('/api/servers', express.json(), (req, res) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {}
        // El panel manda `jellyfinUrl`; la API pública también acepta `url`.
        const jellyfinUrl = body.jellyfinUrl || body.url
        const { label, code } = body
        if (!jellyfinUrl || !/^https?:\/\//i.test(jellyfinUrl)) {
            return res.status(400).json({ error: 'invalid_url', message: 'La URL debe empezar por http:// o https://' })
        }
        if (code && Store.codeInUse(code)) {
            return res.status(409).json({ error: 'code_taken', message: 'Ese código ya existe.' })
        }
        res.json(Store.addServer({ jellyfinUrl, label, code: code ? normalizeCode(code) : generateCode() }))
    })

    router.put('/api/servers/:id', express.json(), (req, res) => {
        const { jellyfinUrl, label, code, active, apiKey } = req.body || {}
        if (code && Store.codeInUse(code, req.params.id)) {
            return res.status(409).json({ error: 'code_taken', message: 'Ese código ya existe.' })
        }
        const patch = { active }
        if (jellyfinUrl !== undefined && jellyfinUrl !== '') patch.jellyfinUrl = jellyfinUrl
        if (label !== undefined) patch.label = label
        if (code !== undefined && code !== '') patch.code = code
        if (apiKey !== undefined && apiKey !== '') patch.apiKey = apiKey
        const updated = Store.updateServer(req.params.id, patch)
        if (!updated) return res.status(404).json({ error: 'not_found' })
        res.json(updated)
    })

    router.delete('/api/servers/:id', (req, res) => {
        Store.removeServer(req.params.id)
        res.json({ ok: true })
    })

    router.post('/api/servers/:id/test', async (req, res) => {
        const server = Store.findById(req.params.id)
        if (!server) return res.status(404).json({ error: 'not_found' })
        try {
            const info = await jellyfin.publicInfo(server.jellyfinUrl)
            let library = null
            if (server.apiKey) {
                try {
                    const userId = await jellyfin.pickUserId(server.jellyfinUrl, server.apiKey)
                    library = { userId }
                } catch (error) {
                    library = { error: error.message }
                }
            }
            res.json({ ok: true, ...info, library })
        } catch (error) {
            res.status(502).json({ ok: false, message: `No se pudo conectar: ${error.message}` })
        }
    })

    // ---------- branding assets ----------
    router.post('/api/assets/:slot', upload.single('file'), (req, res) => {
        const slot = req.params.slot
        if (!ASSET_SLOTS.includes(slot)) {
            if (req.file) fs.rmSync(req.file.path, { force: true })
            return res.status(400).json({ error: 'invalid_slot' })
        }
        if (!req.file) return res.status(400).json({ error: 'no_file' })
        const max = MAX_ASSET_BYTES[slot] || MAX_ASSET_BYTES.default
        if (req.file.size > max) {
            fs.rmSync(req.file.path, { force: true })
            return res.status(413).json({ error: 'too_large', message: 'La imagen es demasiado grande.' })
        }

        const previous = Store.assets[slot]
        if (previous) fs.rmSync(path.join(paths.assets, previous), { force: true })

        const ext = path.extname(req.file.filename)
        const finalName = `${slot}-${Date.now()}${ext}`
        fs.renameSync(req.file.path, path.join(paths.assets, finalName))
        Store.setAsset(slot, finalName)
        res.json({ slot, url: `/branding/${slot}` })
    })

    router.delete('/api/assets/:slot', (req, res) => {
        const slot = req.params.slot
        const previous = Store.assets[slot]
        if (previous) fs.rmSync(path.join(paths.assets, previous), { force: true })
        Store.removeAsset(slot)
        res.json({ ok: true })
    })

    // ---------- YouTube Music imports ----------
    router.post('/api/imports', express.json(), async (req, res) => {
        const { url, serverId } = req.body || {}
        const server = Store.findById(serverId) || Store.servers[0]
        if (!server) return res.status(400).json({ error: 'no_server', message: 'Primero añade un servidor.' })
        let credentials
        try {
            credentials = await jellyfin.resolveCredentials(server)
        } catch (error) {
            return res.status(400).json({ error: 'no_credentials', message: error.message })
        }

        try {
            const playlist = await fetchPlaylist(url, { limit: 500 })
            const { token, userId } = credentials

            const tracks = await mapLimit(playlist.tracks, 4, async track => {
                const term = `${track.title} ${track.artist}`.trim()
                let candidates = []
                try {
                    candidates = await jellyfin.searchTracks(server.jellyfinUrl, token, userId, term, 6)
                } catch {
                    candidates = []
                }
                return { ...track, ...rankCandidates(track, candidates) }
            })

            const id = crypto.randomUUID()
            const record = {
                id,
                title: playlist.title,
                sourceUrl: playlist.sourceUrl,
                serverId: server.id,
                createdAt: new Date().toISOString(),
                tracks,
            }
            Store.saveImport(id, record)
            res.json(record)
        } catch (error) {
            res.status(502).json({ error: 'import_failed', message: error.message })
        }
    })

    router.get('/api/imports/:id', (req, res) => {
        const record = Store.getImport(req.params.id)
        if (!record) return res.status(404).json({ error: 'not_found' })
        res.json(record)
    })

    router.put('/api/imports/:id', express.json({ limit: '512kb' }), (req, res) => {
        const record = Store.getImport(req.params.id)
        if (!record) return res.status(404).json({ error: 'not_found' })
        const overrides = req.body?.overrides || {}
        record.tracks = record.tracks.map((track, index) => {
            if (!(index in overrides)) return track
            const chosenId = overrides[index]
            if (chosenId === null) return { ...track, chosenId: null, status: 'none' }
            const candidate = (track.candidates || []).find(c => c.itemId === chosenId)
            return {
                ...track,
                chosenId,
                // Picked by hand: always counts as matched, even if it was not a candidate
                status: 'auto',
                score: candidate?.score ?? track.score,
                manual: !candidate,
            }
        })
        Store.saveImport(req.params.id, record)
        res.json(record)
    })

    router.post('/api/imports/:id/apply', express.json(), async (req, res) => {
        const record = Store.getImport(req.params.id)
        if (!record) return res.status(404).json({ error: 'not_found' })
        const { serverId, playlistName, mode = 'create', playlistId } = req.body || {}
        const server = Store.findById(serverId || record.serverId)
        if (!server) return res.status(400).json({ error: 'no_server' })

        let credentials
        try {
            credentials = await jellyfin.resolveCredentials(server)
        } catch (error) {
            return res.status(400).json({ error: 'no_credentials', message: error.message })
        }

        const { ids, duplicates, excluded } = selectPlaylistIds(record.tracks)
        if (!ids.length) return res.status(400).json({ error: 'nothing_matched', message: 'No hay pistas emparejadas.' })

        try {
            let targetId = playlistId
            if (mode === 'create' || !targetId) {
                targetId = await jellyfin.createPlaylist(server.jellyfinUrl, credentials.token, playlistName || record.title)
            }
            await jellyfin.addToPlaylist(server.jellyfinUrl, credentials.token, targetId, ids)
            record.applied = { playlistId: targetId, at: new Date().toISOString(), count: ids.length }
            Store.saveImport(record.id, record)
            res.json({ ok: true, playlistId: targetId, added: ids.length, duplicates, excluded })
        } catch (error) {
            res.status(502).json({ error: 'apply_failed', message: error.message })
        }
    })

    router.delete('/api/imports/:id', (req, res) => {
        Store.data.imports?.[req.params.id] && delete Store.data.imports[req.params.id]
        Store.save()
        res.json({ ok: true })
    })

    return router
}
