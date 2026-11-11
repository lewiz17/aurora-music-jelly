// Starts the gateway/admin (Node) and the web app (Vite) together for local development.
//   npm run dev:all
// App:   http://localhost:5173      Admin: http://localhost:5173/admin  (or :8787/admin)
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

const env = {
    ...process.env,
    PORT: process.env.PORT || '8787',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin1234',
    SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-only-for-local',
}

// A leftover server on the same port would answer instead of the new one (with whatever
// password/data it was started with) and the new process would fail silently.
const portFree = port =>
    new Promise(resolve => {
        const probe = net.createServer()
        probe.once('error', () => resolve(false))
        // Same address the server binds to (config.host): on Windows, probing a different
        // address (e.g. "::") succeeds even when 0.0.0.0:<port> is taken.
        probe.listen(Number(port), env.HOST || '0.0.0.0', () => probe.close(() => resolve(true)))
    })
if (!(await portFree(env.PORT))) {
    console.error(`[dev] El puerto ${env.PORT} ya está en uso: hay otro servidor de Aurora abierto (o cambia PORT).`)
    console.error(`[dev] Ciérralo y vuelve a ejecutar. En PowerShell:  Get-NetTCPConnection -LocalPort ${env.PORT} | % { Stop-Process -Id $_.OwningProcess }`)
    process.exit(1)
}

console.log(`[dev] usuario del panel: ${env.ADMIN_USER || 'admin'} / contraseña: ${env.ADMIN_PASSWORD}`)

const children = [
    spawn(process.execPath, ['--watch', 'server/src/index.js'], { cwd: root, env, stdio: 'inherit' }),
    spawn(process.execPath, [viteBin], { cwd: root, env, stdio: 'inherit' }),
]

let exiting = false
const stop = code => {
    if (exiting) return
    exiting = true
    for (const child of children) child.kill()
    process.exit(code)
}

for (const child of children) child.on('exit', code => stop(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0))
