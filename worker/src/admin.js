/**
 * Admin API (mounted at /admin/api). Same routes and response shapes as server/src/admin.js, so the
 * panel in server/admin/index.html works unchanged. Differences, all forced by the runtime:
 *  - the panel credentials are the ADMIN_USER / ADMIN_PASSWORD secrets (no stored hash, so no scrypt:
 *    a login would blow the free plan's 10 ms CPU budget);
 *  - images go to R2 and state to the database;
 *  - importing is a sequence of small steps (read pages, match a batch) instead of one long request,
 *    because a Worker request has limited subrequests and CPU.
 */
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { mapLimit, rankCandidates, selectPlaylistIds } from '../../server/src/match.js'
import { readPlaylistPage } from '../../server/src/ytmusic.js'
import { bucketOf } from './bucket.js'
import { blockedResponse, clientIp, getStore, limitsOf, secretOf } from './context.js'
import { makeAdminToken, safeEqual, verifyAdminToken } from './crypto.js'
import {
    addToPlaylist,
    adminSession,
    connectAdminAccount,
    createPlaylist,
    pickUserId,
    publicInfo,
    resolveCredentials,
    searchTracks,
} from './jellyfin.js'
import { THEMES, generateCode, normalizeCode } from './store.js'

const ASSET_SLOTS = ['logo', 'logoDark', 'icon', 'loginBackground', 'albumPlaceholder', 'artistPlaceholder']
const MAX_ASSET_BYTES = { default: 4 * 1024 * 1024, loginBackground: 12 * 1024 * 1024 }
const IMAGE_TYPE = /image\/(png|jpeg|webp|svg\+xml|avif|gif)/
const SETTINGS_KEYS = ['brandName', 'defaultTheme', 'defaultLanguage', 'codeFieldLabel', 'codeFieldPlaceholder', 'hideAbout']

const MATCH_BATCH = env => Number(env.MATCH_BATCH || 25) // Jellyfin searches per step (subrequests are capped per request)
const YT_PAGES_PER_STEP = env => Number(env.YT_PAGES_PER_STEP || 2)
const IMPORT_LIMIT = 500

const readJson = async c => {
    try {
        const body = await c.req.json()
        return body && typeof body === 'object' ? body : {}
    } catch {
        return {}
    }
}

const extensionOf = (name, type) => {
    const fromName = /\.[a-z0-9]{1,5}$/i.exec(name || '')?.[0]
    if (fromName) return fromName.toLowerCase()
    return { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg' }[type] || ''
}

/** What the panel receives for an import (no internal continuation token, plus progress flags). */
const importView = record => ({
    ...Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'continuation')),
    pending: (record.tracks || []).filter(track => track.status === 'pending').length,
    reading: Boolean(record.continuation),
})

export const publicBranding = settings => ({
    brandName: settings.brandName || 'Aurora Music',
    defaultTheme: settings.defaultTheme,
    defaultLanguage: settings.defaultLanguage,
    codeFieldLabel: settings.codeFieldLabel,
    codeFieldPlaceholder: settings.codeFieldPlaceholder,
    hideAbout: Boolean(settings.hideAbout),
    playerType: 'Aurora',
})

export const brandingAssets = assets => {
    const url = slot => (assets[slot] ? `/branding/${slot}?v=1` : null)
    return Object.fromEntries(ASSET_SLOTS.map(slot => [slot, url(slot)]))
}

export const adminRoutes = new Hono()

const readToken = c => {
    const header = c.req.header('authorization') || ''
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim()
    return getCookie(c, 'aurora_admin')
}

// ---------- auth (public) ----------
adminRoutes.post('/login', async c => {
    const store = await getStore(c.env)
    const key = `admin:${clientIp(c)}`
    const blocked = await blockedResponse(c, store, key)
    if (blocked) return blocked

    const expectedPassword = c.env.ADMIN_PASSWORD
    if (!expectedPassword) {
        return c.json({ error: 'no_admin', message: 'Configura el secreto ADMIN_PASSWORD en Cloudflare.' }, 409)
    }

    const { username, password } = await readJson(c)
    const userOk = await safeEqual(String(username || ''), c.env.ADMIN_USER || 'admin')
    const passOk = await safeEqual(String(password || ''), expectedPassword)
    if (!userOk || !passOk) {
        await store.attempts.fail(key, limitsOf(c.env).windowMs)
        return c.json({ error: 'invalid_credentials', message: 'Usuario o contraseña incorrectos.' }, 401)
    }

    await store.attempts.clear(key)
    const token = await makeAdminToken(secretOf(c.env))
    setCookie(c, 'aurora_admin', token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https',
        maxAge: 60 * 60 * 12,
        path: '/',
    })
    // The panel stores this token and sends it as a Bearer header
    return c.json({ ok: true, token })
})

adminRoutes.post('/logout', c => {
    deleteCookie(c, 'aurora_admin', { path: '/' })
    return c.json({ ok: true })
})

adminRoutes.get('/me', async c => {
    const session = await verifyAdminToken(secretOf(c.env), readToken(c))
    return c.json({ authenticated: Boolean(session), configured: Boolean(c.env.ADMIN_PASSWORD) })
})

// ---------- everything below needs a session ----------
adminRoutes.use('*', async (c, next) => {
    const session = await verifyAdminToken(secretOf(c.env), readToken(c))
    if (!session) return c.json({ error: 'unauthorized' }, 401)
    await next()
})

// ---------- upstream account (used by the importer) ----------
adminRoutes.post('/jellyfin/login', async c => {
    const store = await getStore(c.env)
    const { serverId, username, password } = await readJson(c)
    const server = await store.findById(serverId)
    if (!server) return c.json({ error: 'not_found', message: 'Servidor no encontrado.' }, 404)
    try {
        const session = await connectAdminAccount(c.env, store, server, username, password)
        return c.json({ ok: true, username: session.username })
    } catch (error) {
        return c.json({ error: 'auth_failed', message: error.message }, 401)
    }
})

adminRoutes.get('/jellyfin/status/:id', async c => {
    const store = await getStore(c.env)
    const server = await store.findById(c.req.param('id'))
    if (!server) return c.json({ error: 'not_found' }, 404)
    const session = await adminSession(c.env, store, server)
    return c.json({
        connected: Boolean(session) || Boolean(server.apiKey),
        username: session?.username || null,
        viaApiKey: Boolean(server.apiKey),
    })
})

// ---------- state ----------
adminRoutes.get('/state', async c => {
    const store = await getStore(c.env)
    const data = await store.snapshot()
    return c.json({
        settings: data.settings,
        servers: data.servers,
        assets: data.assets,
        themes: THEMES.map(({ id, name, swatch }) => ({ id, name, swatch })),
        imports: await store.listImports(),
    })
})

adminRoutes.put('/settings', async c => {
    const store = await getStore(c.env)
    const body = await readJson(c)
    const patch = {}
    for (const key of SETTINGS_KEYS) if (key in body) patch[key] = body[key]
    return c.json(await store.updateSettings(patch))
})

// ---------- servers ----------
adminRoutes.post('/servers', async c => {
    const store = await getStore(c.env)
    const body = await readJson(c)
    // The panel sends `jellyfinUrl`; the public API also accepts `url`.
    const jellyfinUrl = body.jellyfinUrl || body.url
    const { label, code } = body
    if (!jellyfinUrl || !/^https?:\/\//i.test(jellyfinUrl)) {
        return c.json({ error: 'invalid_url', message: 'La URL debe empezar por http:// o https://' }, 400)
    }
    if (code && (await store.codeInUse(code))) {
        return c.json({ error: 'code_taken', message: 'Ese código ya existe.' }, 409)
    }
    return c.json(await store.addServer({ jellyfinUrl, label, code: code ? normalizeCode(code) : generateCode() }))
})

adminRoutes.put('/servers/:id', async c => {
    const store = await getStore(c.env)
    const id = c.req.param('id')
    const { jellyfinUrl, label, code, active, apiKey } = await readJson(c)
    if (code && (await store.codeInUse(code, id))) {
        return c.json({ error: 'code_taken', message: 'Ese código ya existe.' }, 409)
    }
    const patch = { active }
    if (jellyfinUrl !== undefined && jellyfinUrl !== '') patch.jellyfinUrl = jellyfinUrl
    if (label !== undefined) patch.label = label
    if (code !== undefined && code !== '') patch.code = code
    if (apiKey !== undefined && apiKey !== '') patch.apiKey = apiKey
    const updated = await store.updateServer(id, patch)
    if (!updated) return c.json({ error: 'not_found' }, 404)
    return c.json(updated)
})

adminRoutes.delete('/servers/:id', async c => {
    const store = await getStore(c.env)
    await store.removeServer(c.req.param('id'))
    return c.json({ ok: true })
})

adminRoutes.post('/servers/:id/test', async c => {
    const store = await getStore(c.env)
    const server = await store.findById(c.req.param('id'))
    if (!server) return c.json({ error: 'not_found' }, 404)
    try {
        const info = await publicInfo(server.jellyfinUrl)
        let library = null
        if (server.apiKey) {
            try {
                library = { userId: await pickUserId(server.jellyfinUrl, server.apiKey) }
            } catch (error) {
                library = { error: error.message }
            }
        }
        return c.json({ ok: true, ...info, library })
    } catch (error) {
        return c.json({ ok: false, message: `No se pudo conectar: ${error.message}` }, 502)
    }
})

// ---------- branding assets (R2) ----------
adminRoutes.post('/assets/:slot', async c => {
    const slot = c.req.param('slot')
    if (!ASSET_SLOTS.includes(slot)) return c.json({ error: 'invalid_slot' }, 400)

    let file
    try {
        file = (await c.req.formData()).get('file')
    } catch {
        file = null
    }
    if (!file || typeof file === 'string') return c.json({ error: 'no_file' }, 400)
    if (!IMAGE_TYPE.test(file.type)) return c.json({ error: 'invalid_type', message: 'Formato no soportado' }, 415)

    const max = MAX_ASSET_BYTES[slot] || MAX_ASSET_BYTES.default
    if (file.size > max) return c.json({ error: 'too_large', message: 'La imagen es demasiado grande.' }, 413)

    const store = await getStore(c.env)
    const bucket = bucketOf(c.env)
    const key = `${slot}-${Date.now()}${extensionOf(file.name, file.type)}`
    await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } })
    const previous = await store.setAsset(slot, key)
    if (previous && previous !== key) await bucket.delete(previous)
    return c.json({ slot, url: `/branding/${slot}` })
})

adminRoutes.delete('/assets/:slot', async c => {
    const store = await getStore(c.env)
    const previous = await store.removeAsset(c.req.param('slot'))
    if (previous) await bucketOf(c.env).delete(previous)
    return c.json({ ok: true })
})

// ---------- YouTube Music imports ----------
const serverFor = async (store, serverId) => (await store.findById(serverId)) || (await store.snapshot()).servers[0]

adminRoutes.post('/imports', async c => {
    const store = await getStore(c.env)
    const { url, serverId } = await readJson(c)
    const server = await serverFor(store, serverId)
    if (!server) return c.json({ error: 'no_server', message: 'Primero añade un servidor.' }, 400)

    try {
        await resolveCredentials(c.env, store, server) // fail early if the library cannot be reached
    } catch (error) {
        return c.json({ error: 'no_credentials', message: error.message }, 400)
    }

    try {
        const first = await readPlaylistPage(url, null)
        let tracks = first.tracks.map(track => ({ ...track, status: 'pending' }))
        let continuation = first.continuation
        if (continuation && tracks.length >= IMPORT_LIMIT) {
            tracks = tracks.slice(0, IMPORT_LIMIT)
            continuation = null
        }
        const record = {
            id: crypto.randomUUID(),
            title: first.title,
            sourceUrl: first.sourceUrl,
            serverId: server.id,
            createdAt: new Date().toISOString(),
            continuation,
            tracks,
        }
        await store.saveImport(record)
        return c.json(importView(record))
    } catch (error) {
        return c.json({ error: 'import_failed', message: error.message }, 502)
    }
})

/**
 * One unit of work per call, so each request stays inside the Worker's limits:
 * first the remaining playlist pages, then batches of Jellyfin searches.
 */
adminRoutes.post('/imports/:id/step', async c => {
    const store = await getStore(c.env)
    const record = await store.getImport(c.req.param('id'))
    if (!record) return c.json({ error: 'not_found' }, 404)

    try {
        if (record.continuation) {
            let pages = 0
            while (record.continuation && pages < YT_PAGES_PER_STEP(c.env) && record.tracks.length < IMPORT_LIMIT) {
                const page = await readPlaylistPage(record.sourceUrl, record.continuation)
                record.tracks.push(...page.tracks.map(track => ({ ...track, status: 'pending' })))
                record.continuation = page.continuation
                pages++
            }
            if (record.tracks.length >= IMPORT_LIMIT) {
                record.tracks = record.tracks.slice(0, IMPORT_LIMIT)
                record.continuation = null
            }
            await store.saveImport(record)
            return c.json({ phase: 'reading', ...progress(record) })
        }

        const batch = []
        record.tracks.forEach((track, index) => {
            if (track.status === 'pending' && batch.length < MATCH_BATCH(c.env)) batch.push(index)
        })
        if (!batch.length) return c.json({ phase: 'done', ...progress(record) })

        const server = await serverFor(store, record.serverId)
        if (!server) return c.json({ error: 'no_server', message: 'El servidor ya no existe.' }, 400)
        const { token, userId } = await resolveCredentials(c.env, store, server)

        await mapLimit(batch, 4, async index => {
            const track = record.tracks[index]
            let candidates = []
            try {
                candidates = await searchTracks(server.jellyfinUrl, token, userId, `${track.title} ${track.artist}`.trim(), 6)
            } catch {
                candidates = []
            }
            record.tracks[index] = { ...track, ...rankCandidates(track, candidates) }
        })
        await store.saveImport(record)
        return c.json({ phase: progress(record).pending ? 'matching' : 'done', ...progress(record) })
    } catch (error) {
        return c.json({ error: 'step_failed', message: error.message }, error.status || 502)
    }
})

const progress = record => ({
    id: record.id,
    total: record.tracks.length,
    pending: record.tracks.filter(track => track.status === 'pending').length,
    reading: Boolean(record.continuation),
})

adminRoutes.get('/imports/:id', async c => {
    const store = await getStore(c.env)
    const record = await store.getImport(c.req.param('id'))
    if (!record) return c.json({ error: 'not_found' }, 404)
    return c.json(importView(record))
})

adminRoutes.put('/imports/:id', async c => {
    const store = await getStore(c.env)
    const record = await store.getImport(c.req.param('id'))
    if (!record) return c.json({ error: 'not_found' }, 404)
    const { overrides = {} } = await readJson(c)
    record.tracks = record.tracks.map((track, index) => {
        if (!(index in overrides)) return track
        const chosenId = overrides[index]
        if (chosenId === null) return { ...track, chosenId: null, status: 'none' }
        const candidate = (track.candidates || []).find(item => item.itemId === chosenId)
        return {
            ...track,
            chosenId,
            // Picked by hand: always counts as matched, even if it was not a candidate
            status: 'auto',
            score: candidate?.score ?? track.score,
            manual: !candidate,
        }
    })
    await store.saveImport(record)
    return c.json(importView(record))
})

adminRoutes.post('/imports/:id/apply', async c => {
    const store = await getStore(c.env)
    const record = await store.getImport(c.req.param('id'))
    if (!record) return c.json({ error: 'not_found' }, 404)
    const { serverId, playlistName, mode = 'create', playlistId } = await readJson(c)
    const server = await store.findById(serverId || record.serverId)
    if (!server) return c.json({ error: 'no_server' }, 400)

    if (record.continuation || record.tracks.some(track => track.status === 'pending')) {
        return c.json({ error: 'incomplete', message: 'La lista aún se está leyendo o emparejando.' }, 409)
    }

    let credentials
    try {
        credentials = await resolveCredentials(c.env, store, server)
    } catch (error) {
        return c.json({ error: 'no_credentials', message: error.message }, 400)
    }

    const { ids, duplicates, excluded } = selectPlaylistIds(record.tracks)
    if (!ids.length) return c.json({ error: 'nothing_matched', message: 'No hay pistas emparejadas.' }, 400)

    try {
        let targetId = playlistId
        if (mode === 'create' || !targetId) {
            targetId = await createPlaylist(server.jellyfinUrl, credentials.token, playlistName || record.title)
        }
        await addToPlaylist(server.jellyfinUrl, credentials.token, targetId, ids)
        record.applied = { playlistId: targetId, at: new Date().toISOString(), count: ids.length }
        await store.saveImport(record)
        return c.json({ ok: true, playlistId: targetId, added: ids.length, duplicates, excluded })
    } catch (error) {
        return c.json({ error: 'apply_failed', message: error.message }, 502)
    }
})

adminRoutes.delete('/imports/:id', async c => {
    const store = await getStore(c.env)
    await store.deleteImport(c.req.param('id'))
    return c.json({ ok: true })
})
