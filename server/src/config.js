import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

/**
 * How many reverse proxies sit in front of the app (Express "trust proxy"): it decides which
 * X-Forwarded-For entry is the real client. It matters for the login rate limit: with the wrong
 * value every visitor looks like the proxy and shares one bucket, or a client could spoof its IP.
 * TRUST_PROXY: a number of hops (default 1), "0"/"false" for none, or a list of IPs/CIDRs.
 */
export const parseTrustProxy = value => {
    if (value === undefined || value === '') return 1
    if (/^\d+$/.test(value)) return Number(value) === 0 ? false : Number(value)
    if (value === 'false') return false
    return value
}

export const config = {
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    port: Number(process.env.PORT || 8787),
    host: process.env.HOST || '0.0.0.0',
    // Where the JSON database and uploaded assets live.
    dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
    // Optional Postgres persistence (see persist.js). Empty = JSON file only, as always.
    databaseUrl: process.env.DATABASE_URL || '',
    // Built web app (yarn build output)
    webDir: path.resolve(process.env.WEB_DIR || path.join(root, '..', 'dist')),
    // Admin panel static files
    adminDir: path.join(root, 'admin'),
    // Secret used to sign admin session cookies
    secret: process.env.SESSION_SECRET || '',
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    // Set to '1' to log every proxied request (noisy)
    debugProxy: process.env.DEBUG_PROXY === '1',
    // Failed logins allowed per IP and window before answering 429 (admin panel and gateway login)
    loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES || 10),
    loginWindowMs: Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000),
}

export const paths = {
    data: path.join(config.dataDir, 'aurora.json'),
    assets: path.join(config.dataDir, 'assets'),
    tmp: path.join(config.dataDir, 'tmp'),
}

for (const dir of [config.dataDir, paths.assets, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true })
}
