import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const serverEntry = path.resolve(here, '..', 'src', 'index.js')

export const freePort = () =>
    new Promise((resolve, reject) => {
        const srv = net.createServer()
        srv.once('error', reject)
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address()
            srv.close(() => resolve(port))
        })
    })

export const AUDIO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))

/** Minimal stand-in for a Jellyfin server. `seen` records the last request headers per path. */
export const startFakeJellyfin = async () => {
    const seen = {}
    /** Playlists created through the admin panel: { id, name, adds: [[ids...], ...] } */
    const playlists = []
    /** How many times each endpoint was actually hit (unlike `seen`, which only keeps the last headers). */
    const hits = {}
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://x')
        seen[url.pathname] = req.headers
        hits[url.pathname] = (hits[url.pathname] || 0) + 1

        if (url.pathname === '/Users' && req.method === 'GET') {
            return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ Id: 'admin-1', Policy: { IsAdministrator: true } }]))
        }
        if (url.pathname === '/Playlists' && req.method === 'POST') {
            let body = ''
            req.on('data', c => (body += c))
            req.on('end', () => {
                const playlist = { id: `pl-${playlists.length + 1}`, name: JSON.parse(body || '{}').Name, adds: [] }
                playlists.push(playlist)
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ Id: playlist.id }))
            })
            return
        }
        const addMatch = /^\/Playlists\/([^/]+)\/Items$/.exec(url.pathname)
        if (addMatch && req.method === 'POST') {
            const playlist = playlists.find(p => p.id === addMatch[1])
            if (!playlist) return res.writeHead(404).end()
            playlist.adds.push({ ids: (url.searchParams.get('ids') || '').split(','), urlLength: req.url.length })
            return res.writeHead(204).end()
        }
        const json = (status, body, gzip = false) => {
            const raw = Buffer.from(JSON.stringify(body))
            const data = gzip ? zlib.gzipSync(raw) : raw
            res.writeHead(status, {
                'content-type': 'application/json',
                ...(gzip ? { 'content-encoding': 'gzip' } : {}),
            })
            res.end(data)
        }

        if (url.pathname === '/Users/AuthenticateByName' && req.method === 'POST') {
            let body = ''
            req.on('data', c => (body += c))
            req.on('end', () => {
                const { Username, Pw } = JSON.parse(body || '{}')
                if (Username === 'demo' && Pw === 'secret') {
                    return json(200, { AccessToken: 'upstream-token', User: { Id: 'user-1', Name: 'demo' } })
                }
                json(401, { error: 'bad' })
            })
            return
        }
        if (url.pathname === '/System/Info/Public') {
            return json(200, { ServerName: 'Mi Jellyfin', Version: '10.9.0' })
        }
        // Always compressed, and mentions the engine name so we can check scrubbing.
        if (url.pathname === '/Items') return json(200, { Items: [{ Name: 'Jellyfin song' }] }, true)
        if (url.pathname === '/Audio/1/universal') {
            const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
            if (!range) {
                res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': AUDIO.length })
                return res.end(AUDIO)
            }
            const start = Number(range[1])
            const end = range[2] ? Number(range[2]) : AUDIO.length - 1
            const chunk = AUDIO.subarray(start, end + 1)
            res.writeHead(206, {
                'content-type': 'audio/mpeg',
                'content-length': chunk.length,
                'content-range': `bytes ${start}-${end}/${AUDIO.length}`,
            })
            return res.end(chunk)
        }
        res.writeHead(404).end()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        seen,
        hits,
        playlists,
        close: () => new Promise(resolve => server.close(resolve)),
    }
}

/** Spawns the real server (server/src/index.js) with an isolated data dir. */
export const startAurora = async (extraEnv = {}, { dataDir: existingDataDir } = {}) => {
    const port = await freePort()
    const dataDir = existingDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-test-'))
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-web-'))
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>app</title>')
    fs.mkdirSync(path.join(webDir, 'assets'))
    fs.writeFileSync(path.join(webDir, 'assets', 'ok.js'), 'export default 1')
    fs.writeFileSync(path.join(webDir, 'favicon-96x96.png'), 'png')

    const child = spawn(process.execPath, [serverEntry], {
        env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            DATA_DIR: dataDir,
            WEB_DIR: webDir,
            ADMIN_USER: 'admin',
            ADMIN_PASSWORD: 'test1234',
            SESSION_SECRET: 'test-secret',
            ...extraEnv,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 10000)
        const onData = chunk => {
            output += chunk
            if (output.includes('escuchando')) {
                clearTimeout(timer)
                resolve()
            }
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', c => (output += c))
        child.once('exit', code => reject(new Error(`server exited (${code}):\n${output}`)))
    })

    const base = `http://127.0.0.1:${port}`
    return {
        base,
        dataDir,
        output: () => output,
        async stop() {
            child.kill()
            await new Promise(resolve => (child.exitCode !== null ? resolve() : child.once('exit', resolve)))
            if (!existingDataDir) fs.rmSync(dataDir, { recursive: true, force: true })
            fs.rmSync(webDir, { recursive: true, force: true })
        },
        async adminLogin(password = 'test1234', username = 'admin') {
            const res = await fetch(`${base}/admin/api/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username, password }),
            })
            return { res, body: await res.json() }
        },
    }
}
