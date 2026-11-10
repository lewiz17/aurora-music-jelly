import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

export const config = {
    port: Number(process.env.PORT || 8787),
    host: process.env.HOST || '0.0.0.0',
    // Where the JSON database and uploaded assets live.
    dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
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
}

export const paths = {
    data: path.join(config.dataDir, 'aurora.json'),
    assets: path.join(config.dataDir, 'assets'),
    tmp: path.join(config.dataDir, 'tmp'),
}

for (const dir of [config.dataDir, paths.assets, paths.tmp]) {
    fs.mkdirSync(dir, { recursive: true })
}
