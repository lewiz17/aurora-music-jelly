/**
 * The public side: login by access code and the transparent gateway to Jellyfin.
 * Port of server/src/proxy.js to the Workers runtime (web-standard Request/Response, streaming).
 */
import { createSessionToken, readSessionToken } from './crypto.js'
import { blockedResponse, clientIp, getStore, limitsOf, secretOf } from './context.js'
import { normalizeCode } from './store.js'

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
    `MediaBrowser Client="Aurora", Device="Web", DeviceId="aurora-gateway", Version="1.0.0"`

const authenticateUpstream = async (serverUrl, username, password) => {
    const response = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { Authorization: clientHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: username, Pw: password }),
        signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw Object.assign(new Error('auth_failed'), { status: response.status })
    return response.json()
}

const readBody = async c => {
    try {
        return (await c.req.json()) || {}
    } catch {
        return {}
    }
}

/** Only small JSON is rewritten (to hide the engine name): rewriting costs CPU, which is budgeted per request. */
const scrubLimit = env => Number(env.SCRUB_MAX_BYTES || 1_000_000)

export const registerGateway = app => {
    app.post('/api/login', async c => {
        const store = await getStore(c.env)
        const key = `gateway:${clientIp(c)}`
        const blocked = await blockedResponse(c, store, key)
        if (blocked) return blocked

        const { code, username, password } = await readBody(c)
        if (!code || !username) {
            return c.json({ error: 'missing_fields', message: 'Faltan datos.' }, 400)
        }

        const server = await store.findByCode(normalizeCode(code))
        if (!server) {
            await store.attempts.fail(key, limitsOf(c.env).windowMs)
            return c.json({ error: 'unknown_code', message: 'Código no válido.' }, 404)
        }

        try {
            const auth = await authenticateUpstream(server.jellyfinUrl, username, password || '')
            await store.attempts.clear(key)
            const token = await createSessionToken(secretOf(c.env), {
                serverId: server.id,
                upstreamToken: auth.AccessToken,
                userId: auth.User.Id,
                username: auth.User.Name,
            })
            return c.json({ token, userId: auth.User.Id, username: auth.User.Name })
        } catch (error) {
            const status = error.status === 401 ? 401 : 502
            // Only wrong credentials count: an unreachable Jellyfin is not the caller's fault
            if (status === 401) await store.attempts.fail(key, limitsOf(c.env).windowMs)
            return c.json(
                {
                    error: status === 401 ? 'invalid_credentials' : 'upstream_unreachable',
                    message:
                        status === 401
                            ? 'Usuario o contraseña incorrectos.'
                            : 'No se pudo conectar. Inténtalo más tarde.',
                },
                status
            )
        }
    })

    app.post('/api/resolve-code', async c => {
        const store = await getStore(c.env)
        const key = `gateway:${clientIp(c)}`
        const blocked = await blockedResponse(c, store, key)
        if (blocked) return blocked

        const { code } = await readBody(c)
        const server = await store.findByCode(normalizeCode(code))
        if (!server) {
            await store.attempts.fail(key, limitsOf(c.env).windowMs) // otherwise a free oracle to enumerate codes
            return c.json({ valid: false }, 404)
        }
        return c.json({ valid: true })
    })

    // The transparent gateway: /jf/<gatewayToken>/Items/... -> <jellyfin>/Items/...
    app.all('/jf/:token/*', async c => {
        const token = c.req.param('token')
        const session = await readSessionToken(secretOf(c.env), token)
        if (!session) return c.json({ error: 'session_expired' }, 401)

        const store = await getStore(c.env)
        const server = await store.findById(session.serverId)
        if (!server || server.active === false) return c.json({ error: 'server_removed' }, 410)

        const incoming = new URL(c.req.url)
        const prefix = `/jf/${token}/`
        const target = new URL(`${server.jellyfinUrl}/${incoming.pathname.slice(prefix.length)}${incoming.search}`)

        // Never forward the gateway token as an ApiKey (images append it)
        target.searchParams.delete('apiKey')
        target.searchParams.delete('ApiKey')

        const headers = new Headers()
        for (const [name, value] of c.req.raw.headers) {
            const lower = name.toLowerCase()
            if (HOP_BY_HOP.has(lower) || lower === 'authorization') continue
            // the runtime decodes compressed bodies itself; ask for plain data from the origin
            if (lower === 'accept-encoding') continue
            // Cloudflare/proxy plumbing, not meant for the origin
            if (lower.startsWith('cf-') || lower.startsWith('x-forwarded-') || lower === 'x-real-ip') continue
            headers.set(name, value)
        }
        headers.set('authorization', `${clientHeaders()}, Token="${session.upstreamToken}"`)

        const method = c.req.method
        const hasBody = method !== 'GET' && method !== 'HEAD'

        let upstream
        try {
            upstream = await fetch(target, {
                method,
                headers,
                body: hasBody ? c.req.raw.body : undefined,
                ...(hasBody ? { duplex: 'half' } : {}),
                redirect: 'manual',
                // client went away mid-transfer: stop the upstream work too
                signal: c.req.raw.signal,
            })
        } catch {
            return c.json({ error: 'upstream_unreachable' }, 502)
        }

        const out = new Headers()
        for (const [name, value] of upstream.headers) {
            const lower = name.toLowerCase()
            if (lower === 'set-cookie') continue // do not leak upstream identity/host details
            if (HOP_BY_HOP.has(lower) && lower !== 'content-length') continue
            out.set(name, value)
        }
        // Jellyfin may emit absolute redirects to its own (hidden) URL
        const location = upstream.headers.get('location')
        if (location && location.startsWith(server.jellyfinUrl)) {
            out.set('location', location.replace(server.jellyfinUrl, `/jf/${token}`))
        }

        const contentType = upstream.headers.get('content-type') || ''
        const declared = Number(upstream.headers.get('content-length') || 0)

        // Scrub anything that would reveal what is behind the gateway (small JSON only).
        if (contentType.includes('json') && declared < scrubLimit(c.env)) {
            const cfg = await store.config()
            const brand = cfg.settings.brandName || 'Aurora'
            const text = (await upstream.text())
                .replaceAll('Jellyfin Server', brand)
                .replaceAll('Jellyfin', brand)
                .replaceAll('jellyfin', brand.toLowerCase())
                .replaceAll('MediaBrowser', brand)
            // the body was decoded and its length changed: these headers no longer describe it
            out.delete('content-encoding')
            out.delete('content-length')
            return new Response(text, { status: upstream.status, headers: out })
        }

        // Everything else (audio, images, HLS segments) is streamed straight through.
        return new Response(upstream.body, { status: upstream.status, headers: out })
    })
}
