import express from 'express'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import path from 'node:path'
import { config, paths } from './config.js'
import { Store, normalizeCode } from './store.js'
import { createProxyRouter } from './proxy.js'
import { createAdminRouter, publicBranding } from './admin.js'
import { THEMES } from './themes.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(cookieParser())

// Security headers. The app loads images/audio only from itself (everything is proxied).
// Framing: use a CSP frame-ancestors allowlist instead of hard X-Frame-Options so the app
// and the panel can also be opened inside a preview iframe on another origin.
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS || "'self' https: http:"
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Content-Security-Policy', `frame-ancestors ${FRAME_ANCESTORS}`)
    if (FRAME_ANCESTORS === "'self'") res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    next()
})

// ---------- bootstrap admin ----------
const bootstrap = async () => {
    const password = config.adminPassword
    if (!Store.hasAdmin && password) {
        Store.setAdmin(config.adminUser, password)
        console.log(`[aurora] admin creado: ${config.adminUser}`)
    }
    if (!Store.hasAdmin) {
        // First run without env vars: generate credentials and print them once
        const generated = Math.random().toString(36).slice(2, 10)
        Store.setAdmin(config.adminUser, generated)
        console.log('─'.repeat(58))
        console.log('  No ADMIN_PASSWORD found. Generated admin credentials:')
        console.log(`     usuario:  ${config.adminUser}`)
        console.log(`     password: ${generated}`)
        console.log('  Guarda esto o define ADMIN_PASSWORD en el entorno.')
        console.log('─'.repeat(58))
    }
    if (!config.secret) {
        console.warn('[aurora] SESSION_SECRET no definido: usando una clave derivada. Define SESSION_SECRET en producción.')
    }
}
await bootstrap()

// ---------- CORS for sandboxed previews ----------
// When the panel/app is embedded in a sandboxed iframe on another origin, the browser sends
// `Origin: null` and needs CORS headers for its fetch/XHR calls. This is opt-in: it only
// echoes the null origin, never '*' with credentials, so normal deployments are unaffected.
if (process.env.SANDBOX_ORIGIN === '1') {
    app.use((req, res, next) => {
        if (req.headers.origin === 'null') {
            res.setHeader('Access-Control-Allow-Origin', 'null')
            res.setHeader('Vary', 'Origin')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Emby-Authorization')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
            res.setHeader('Access-Control-Max-Age', '600')
            if (req.method === 'OPTIONS') return res.status(204).end()
        }
        next()
    })
}

// ---------- public configuration for the web client ----------
app.get('/api/app-config', (_req, res) => {
    const branding = publicBranding()
    const theme = THEMES.find(t => t.id === branding.defaultTheme) || THEMES[0]
    res.setHeader('Cache-Control', 'no-store')
    res.json({ ...branding, themeVars: { light: theme.light, dark: theme.dark } })
})

// ---------- gateway ----------
app.use(createProxyRouter())

// ---------- branding assets ----------
app.get('/branding/:slot', (req, res) => {
    const filename = Store.assets[req.params.slot]
    if (!filename) return res.status(404).end()
    const file = path.join(paths.assets, filename)
    if (!fs.existsSync(file)) return res.status(404).end()
    res.setHeader('Cache-Control', 'public, max-age=60')
    res.sendFile(file)
})

// Dynamic app icon (favicon / PWA manifest) using the uploaded branding
const sendIcon = (_req, res) => {
    const filename = Store.assets.icon
    if (filename) return res.sendFile(path.join(paths.assets, filename))
    return res.sendFile(path.join(config.webDir, 'favicon-96x96.png'))
}
app.get('/favicon.ico', sendIcon)
app.get('/favicon-96x96.png', sendIcon)
app.get('/apple-touch-icon.png', sendIcon)

// ---------- admin panel ----------
app.get(['/admin', '/admin/'], (_req, res) => res.sendFile(path.join(config.adminDir, 'index.html')))
app.use('/admin', express.static(config.adminDir, { extensions: ['html'], redirect: false }))
app.use('/admin', createAdminRouter())
app.get('/admin/*', (_req, res) => res.sendFile(path.join(config.adminDir, 'index.html')))

// ---------- web app ----------
if (fs.existsSync(path.join(config.webDir, 'index.html'))) {
    app.use(
        express.static(config.webDir, {
            setHeaders: (res, filePath) => {
                if (/\/assets\//.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
                }
            },
        })
    )
    app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/jf')) return next()
        res.sendFile(path.join(config.webDir, 'index.html'))
    })
} else {
    app.get('/', (_req, res) =>
        res
            .status(200)
            .type('html')
            .send(
                `<body style="font-family:ui-sans-serif,system-ui;padding:40px;max-width:640px;margin:auto;line-height:1.6">
                 <h1>Aurora</h1><p>El servidor está arrancado, pero falta compilar la app web.</p>
                 <p>Ejecuta <code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code> y vuelve a cargar.</p>
                 <p>El panel de administración está en <a href="/admin">/admin</a>.</p></body>`
            )
    )
}

app.use((_req, res) => res.status(404).json({ error: 'not_found' }))

app.listen(config.port, config.host, () => {
    console.log(`[aurora] escuchando en http://${config.host}:${config.port}`)
    console.log(`[aurora] admin:  http://localhost:${config.port}/admin`)
    console.log(`[aurora] datos:  ${config.dataDir}`)
    if (Store.servers.length) {
        console.log('[aurora] códigos activos:', Store.servers.map(s => normalizeCode(s.code)).join(', '))
    }
})
