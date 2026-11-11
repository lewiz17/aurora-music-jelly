import express from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from './config.js'
import { normalizeCode, Store } from './store.js'
import { createSessionToken, readSessionToken } from './session.js'
import { blockedGuard, createLimiter } from './ratelimit.js'

const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length',
    'cookie',
])

const clientHeaders = () =>
    `MediaBrowser Client="Aurora", Device="Web", DeviceId="${'aurora-gateway'}", Version="1.0.0"`

const upstreamFetch = async (url, options = {}) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
        return await fetch(url, { ...options, signal: controller.signal })
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * Auth against Jellyfin happens here, server side.
 * The browser never learns the Jellyfin URL, only an opaque gateway token.
 */
const authenticateUpstream = async (serverUrl, username, password) => {
    const response = await upstreamFetch(`${serverUrl}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
            Authorization: clientHeaders(),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ Username: username, Pw: password }),
    })

    if (!response.ok) {
        const error = new Error('auth_failed')
        error.status = response.status
        throw error
    }

    return response.json()
}

export const createProxyRouter = () => {
    const router = express.Router()
    const limiter = createLimiter({ windowMs: config.loginWindowMs, max: config.loginMaxFailures })
    const guard = blockedGuard(limiter, 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.')

    /**
     * Public: login with access code + credentials.
     * Returns a gateway token that the app uses exactly like a Jellyfin token.
     */
    router.post('/api/login', guard, express.json({ limit: '32kb' }), async (req, res) => {
        const { code, username, password } = req.body || {}
        if (!code || !username) {
            return res.status(400).json({ error: 'missing_fields', message: 'Faltan datos.' })
        }

        const server = Store.findByCode(normalizeCode(code))
        if (!server) {
            limiter.fail(req.ip)
            return res.status(404).json({ error: 'unknown_code', message: 'Código no válido.' })
        }

        try {
            const auth = await authenticateUpstream(server.jellyfinUrl, username, password || '')
            limiter.clear(req.ip)
            const token = createSessionToken({
                serverId: server.id,
                upstreamToken: auth.AccessToken,
                userId: auth.User.Id,
                username: auth.User.Name,
            })
            res.json({
                token,
                userId: auth.User.Id,
                username: auth.User.Name,
            })
        } catch (error) {
            const status = error.status === 401 ? 401 : 502
            // Only wrong credentials count: an unreachable Jellyfin is not the caller's fault
            if (status === 401) limiter.fail(req.ip)
            res.status(status).json({
                error: status === 401 ? 'invalid_credentials' : 'upstream_unreachable',
                message: status === 401 ? 'Usuario o contraseña incorrectos.' : 'No se pudo conectar. Inténtalo más tarde.',
            })
        }
    })

    // Lightweight health probe used by the login screen (does the code exist?)
    router.post('/api/resolve-code', guard, express.json({ limit: '4kb' }), (req, res) => {
        const server = Store.findByCode(normalizeCode(req.body?.code))
        if (!server) {
            limiter.fail(req.ip) // otherwise this endpoint is a free oracle to enumerate codes
            return res.status(404).json({ valid: false })
        }
        res.json({ valid: true })
    })

    /**
     * The transparent gateway. Everything the app used to send to Jellyfin
     * comes here instead: /jf/<gatewayToken>/Items/...
     */
    router.all('/jf/:token/*', async (req, res) => {
        const session = readSessionToken(req.params.token)
        if (!session) {
            return res.status(401).json({ error: 'session_expired' })
        }

        const server = Store.findById(session.serverId)
        if (!server || server.active === false) {
            return res.status(410).json({ error: 'server_removed' })
        }

        const suffix = req.originalUrl.slice(req.originalUrl.indexOf(`/jf/${req.params.token}/`) + `/jf/${req.params.token}/`.length)
        const target = new URL(`${server.jellyfinUrl}/${suffix}`)

        // Never forward the gateway token as an ApiKey (images append it)
        target.searchParams.delete('apiKey')
        target.searchParams.delete('ApiKey')

        const headers = {}
        for (const [key, value] of Object.entries(req.headers)) {
            if (HOP_BY_HOP.has(key.toLowerCase())) continue
            if (key.toLowerCase() === 'authorization') continue
            // fetch() decodes compressed bodies itself; ask for plain data so the bytes we relay
            // always match the headers we relay.
            if (key.toLowerCase() === 'accept-encoding') continue
            headers[key] = value
        }
        headers.authorization = `${clientHeaders()}, Token="${session.upstreamToken}"`

        // Abort upstream work if the client goes away mid-transfer.
        // NOTE: must listen on the response, not the request: 'close' on req fires as
        // soon as the request body is fully read, which aborted every POST.
        const controller = new AbortController()
        res.on('close', () => {
            if (!res.writableEnded) controller.abort()
        })

        try {
            const upstream = await fetch(target, {
                method: req.method,
                headers,
                body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
                duplex: 'half',
                redirect: 'manual',
                signal: controller.signal,
            })

            if (config.debugProxy) {
                console.log(`[proxy] ${req.method} ${req.path} -> ${upstream.status}`)
            }

            res.status(upstream.status)
            for (const [key, value] of upstream.headers.entries()) {
                if (HOP_BY_HOP.has(key.toLowerCase())) continue
                // Do not leak upstream identity/host details
                if (key.toLowerCase() === 'set-cookie') continue
                // The body was already decoded by fetch(): advertising the encoding would make
                // the browser fail with ERR_CONTENT_DECODING_FAILED.
                if (key.toLowerCase() === 'content-encoding') continue
                res.setHeader(key, value)
            }
            // Behind a subpath proxy Jellyfin may emit absolute redirects to its own (hidden) URL.
            const location = upstream.headers.get('location')
            if (location && location.startsWith(server.jellyfinUrl)) {
                res.setHeader('location', location.replace(server.jellyfinUrl, `/jf/${req.params.token}`))
            }

            const contentType = upstream.headers.get('content-type') || ''
            const declaredLength = Number(upstream.headers.get('content-length') || 0)

            // Scrub anything that would reveal what is behind the gateway (small JSON only).
            if (contentType.includes('json') && declaredLength < 2_000_000) {
                const brand = Store.settings.brandName || 'Aurora'
                const text = Buffer.from(await upstream.arrayBuffer())
                    .toString('utf8')
                    .replaceAll('Jellyfin Server', brand)
                    .replaceAll('Jellyfin', brand)
                    .replaceAll('jellyfin', brand.toLowerCase())
                    .replaceAll('MediaBrowser', brand)
                return res.end(Buffer.from(text, 'utf8'))
            }

            // Everything else (audio, images, HLS segments) is streamed, never held in memory.
            if (!upstream.body) return res.end()
            if (declaredLength) res.setHeader('content-length', String(declaredLength))
            await pipeline(Readable.fromWeb(upstream.body), res)
        } catch (error) {
            if (config.debugProxy) console.error('[proxy] error', req.method, req.path, error?.message, error?.cause?.message)
            if (res.headersSent) return res.end()
            res.status(502).json({ error: 'upstream_unreachable' })
        }
    })

    return router
}
