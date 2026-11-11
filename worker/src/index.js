/**
 * Aurora Music on Cloudflare Workers.
 *
 * Static files (the web app and the admin page) are served by Workers Static Assets and never reach
 * this code. Only the dynamic paths listed in `run_worker_first` (wrangler.jsonc) do:
 *   /api/*  /jf/*  /admin/api/*  /branding/*  and the dynamic favicon.
 */
import { Hono } from 'hono'
import { adminRoutes, brandingAssets, publicBranding } from './admin.js'
import { bucketOf } from './bucket.js'
import { getStore } from './context.js'
import { registerGateway } from './gateway.js'
import { THEMES } from './store.js'

export const createApp = () => {
    const app = new Hono()

    // Security headers. (Static files get theirs from public/_headers, written by prepare-assets.)
    app.use('*', async (c, next) => {
        await next()
        const frameAncestors = c.env.FRAME_ANCESTORS || "'self'"
        // Responses coming from fetch() / the assets binding have immutable headers in Workers:
        // wrap them first (the body is passed through as a stream, not buffered).
        const res = new Response(c.res.body, c.res)
        res.headers.set('X-Content-Type-Options', 'nosniff')
        res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
        res.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors}`)
        if (frameAncestors === "'self'") res.headers.set('X-Frame-Options', 'SAMEORIGIN')
        res.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
        c.res = res
    })

    // Public configuration for the web client
    app.get('/api/app-config', async c => {
        const { settings, assets } = await (await getStore(c.env)).config()
        const theme = THEMES.find(item => item.id === settings.defaultTheme) || THEMES[0]
        c.header('Cache-Control', 'no-store')
        return c.json({
            ...publicBranding(settings),
            assets: brandingAssets(assets),
            themeVars: { light: theme.light, dark: theme.dark },
        })
    })

    registerGateway(app)
    app.route('/admin/api', adminRoutes)

    // Branding images from R2
    const serveAsset = async (c, slot) => {
        const { assets } = await (await getStore(c.env)).config()
        const key = assets[slot]
        const object = key ? await bucketOf(c.env).get(key) : null
        if (!object) return null
        return new Response(object.body, {
            headers: {
                'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
                'Cache-Control': 'public, max-age=60',
            },
        })
    }

    app.get('/branding/:slot', async c => (await serveAsset(c, c.req.param('slot'))) || c.json({ error: 'not_found' }, 404))

    // Dynamic app icon (favicon / PWA) using the uploaded branding, else the bundled static one
    const icon = async c => {
        const uploaded = await serveAsset(c, 'icon')
        if (uploaded) return uploaded
        return c.env.ASSETS.fetch(new Request(new URL('/favicon-96x96.png', c.req.url)))
    }
    app.get('/favicon.ico', icon)
    app.get('/favicon-96x96.png', icon)
    app.get('/apple-touch-icon.png', icon)

    app.notFound(c => {
        // Unknown API paths must not fall into the single-page app
        const path = new URL(c.req.url).pathname
        if (path.startsWith('/api') || path.startsWith('/jf') || path.startsWith('/admin/api') || !c.env.ASSETS) {
            return c.json({ error: 'not_found' }, 404)
        }
        return c.env.ASSETS.fetch(c.req.raw)
    })

    app.onError((error, c) => {
        if (error.code === 'not_configured') {
            return c.json({ error: 'not_configured', message: error.message }, 503)
        }
        console.error('[aurora]', error?.stack || error)
        return c.json({ error: 'internal_error', message: 'Error interno.' }, 500)
    })

    return app
}

const app = createApp()

export default {
    fetch: (request, env, ctx) => app.fetch(request, env, ctx),
}
