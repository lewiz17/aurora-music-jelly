// Builds worker/public: the compiled web app (../dist) plus the admin page and a _headers file.
// Run through `npm run dev|deploy|check` in worker/, after `npm run build` in the project root.
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const out = path.resolve(here, '..', 'public')

if (!existsSync(path.join(root, 'dist', 'index.html'))) {
    console.error('Falta compilar la app web. Ejecuta `npm run build` en la carpeta raíz del proyecto y repite.')
    process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(path.join(root, 'dist'), out, { recursive: true })

mkdirSync(path.join(out, 'admin'), { recursive: true })
copyFileSync(path.join(root, 'server', 'admin', 'index.html'), path.join(out, 'admin', 'index.html'))

// Static files do not pass through the Worker, so their headers are declared here.
writeFileSync(
    path.join(out, '_headers'),
    `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: frame-ancestors 'self'
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), microphone=(), camera=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
`
)

console.log(`worker/public listo (${out})`)
