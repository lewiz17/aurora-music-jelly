import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { AUDIO, startAurora, startFakeJellyfin } from './harness.js'

let aurora
let jelly
let adminToken
let server // { id, code }

const api = (path, { token = adminToken, method = 'GET', body } = {}) =>
    fetch(`${aurora.base}${path}`, {
        method,
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    })

before(async () => {
    jelly = await startFakeJellyfin()
    aurora = await startAurora()
    const { body } = await aurora.adminLogin()
    adminToken = body.token
})

after(async () => {
    await aurora?.stop()
    await jelly?.close()
})

describe('app (web)', () => {
    test('sirve index.html en / y en rutas de la SPA', async () => {
        for (const p of ['/', '/search', '/album/123']) {
            const res = await fetch(aurora.base + p)
            assert.equal(res.status, 200, p)
            assert.match(await res.text(), /<title>app<\/title>/)
        }
    })

    test('sirve los assets existentes y da 404 real a los que faltan', async () => {
        assert.equal((await fetch(`${aurora.base}/assets/ok.js`)).status, 200)
        const missing = await fetch(`${aurora.base}/assets/viejo-123.js`)
        assert.equal(missing.status, 404)
        assert.doesNotMatch(missing.headers.get('content-type') || '', /html/)
    })

    test('/api/app-config devuelve la marca y las variables del tema', async () => {
        const res = await fetch(`${aurora.base}/api/app-config`)
        const cfg = await res.json()
        assert.equal(res.status, 200)
        assert.equal(cfg.brandName, 'Aurora Music')
        assert.ok(cfg.themeVars.dark)
        assert.equal(res.headers.get('cache-control'), 'no-store')
    })

    test('rutas /api y /jf desconocidas no caen en la SPA', async () => {
        const res = await fetch(`${aurora.base}/api/nope`)
        assert.equal(res.status, 404)
        assert.equal((await res.json()).error, 'not_found')
    })

    test('cabeceras de seguridad presentes', async () => {
        const res = await fetch(`${aurora.base}/`)
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
        assert.match(res.headers.get('content-security-policy'), /frame-ancestors/)
        assert.equal(res.headers.get('x-powered-by'), null)
    })
})

describe('admin', () => {
    test('/admin sirve el panel', async () => {
        for (const p of ['/admin', '/admin/']) {
            const res = await fetch(aurora.base + p)
            assert.equal(res.status, 200)
            assert.match(res.headers.get('content-type'), /html/)
        }
    })

    test('el formulario de acceso no trae el usuario rellenado (escribir "admin" daba "adminadmin")', async () => {
        const html = await (await fetch(`${aurora.base}/admin`)).text()
        const field = html.match(/const username = h\('input', \{[^}]*\}\)/)?.[0]
        assert.ok(field, 'no se encontró el campo de usuario')
        assert.doesNotMatch(field, /value\s*:/)
    })

    test('login: credenciales correctas dan token, incorrectas 401', async () => {
        const ok = await aurora.adminLogin()
        assert.equal(ok.res.status, 200)
        assert.ok(ok.body.token)
        assert.match(ok.res.headers.get('set-cookie'), /aurora_admin=.*HttpOnly/i)
        const bad = await aurora.adminLogin('mala')
        assert.equal(bad.res.status, 401)
    })

    test('la API exige sesión y acepta Bearer', async () => {
        assert.equal((await api('/admin/api/state', { token: null })).status, 401)
        assert.equal((await api('/admin/api/state', { token: 'falso.token' })).status, 401)
        const res = await api('/admin/api/state')
        assert.equal(res.status, 200)
        const state = await res.json()
        assert.equal(state.themes.length, 9)
        assert.deepEqual(state.servers, [])
    })

    test('/admin/api/me refleja si hay sesión', async () => {
        const anon = await (await api('/admin/api/me', { token: null })).json()
        assert.equal(anon.authenticated, false)
        const me = await (await api('/admin/api/me')).json()
        assert.equal(me.authenticated, true)
    })

    test('servidores: valida URL, crea, rechaza códigos duplicados (incluso inactivos), edita y borra', async () => {
        const invalid = await api('/admin/api/servers', { method: 'POST', body: { jellyfinUrl: 'ftp://x' } })
        assert.equal(invalid.status, 400)

        const created = await api('/admin/api/servers', {
            method: 'POST',
            body: { jellyfinUrl: jelly.url, label: 'Fake', code: 'familia' },
        })
        assert.equal(created.status, 200)
        server = await created.json()
        assert.equal(server.code, 'FAMILIA')

        const dup = await api('/admin/api/servers', { method: 'POST', body: { jellyfinUrl: jelly.url, code: 'Familia' } })
        assert.equal(dup.status, 409)

        // Desactivado: el código sigue ocupado
        await api(`/admin/api/servers/${server.id}`, { method: 'PUT', body: { active: false } })
        const dupInactive = await api('/admin/api/servers', { method: 'POST', body: { jellyfinUrl: jelly.url, code: 'FAMILIA' } })
        assert.equal(dupInactive.status, 409)
        await api(`/admin/api/servers/${server.id}`, { method: 'PUT', body: { active: true } })

        const other = await (await api('/admin/api/servers', { method: 'POST', body: { jellyfinUrl: jelly.url } })).json()
        assert.match(other.code, /^[A-Z2-9]{6}$/)
        const clash = await api(`/admin/api/servers/${other.id}`, { method: 'PUT', body: { code: 'familia' } })
        assert.equal(clash.status, 409)
        assert.equal((await api(`/admin/api/servers/${other.id}`, { method: 'DELETE' })).status, 200)
        assert.equal((await api('/admin/api/servers/nope', { method: 'PUT', body: { label: 'x' } })).status, 404)
    })

    test('probar servidor: lee nombre y versión del Jellyfin', async () => {
        const res = await api(`/admin/api/servers/${server.id}/test`, { method: 'POST' })
        assert.equal(res.status, 200)
        const info = await res.json()
        assert.equal(info.ok, true)
    })

    test('ajustes: solo se guardan claves permitidas y se ven en la app', async () => {
        const res = await api('/admin/api/settings', {
            method: 'PUT',
            body: { brandName: 'Casa FM', hideAbout: false, admin: 'hack', defaultTheme: 'ocean' },
        })
        const settings = await res.json()
        assert.equal(settings.brandName, 'Casa FM')
        assert.equal(settings.admin, undefined)
        const cfg = await (await fetch(`${aurora.base}/api/app-config`)).json()
        assert.equal(cfg.brandName, 'Casa FM')
        assert.equal(cfg.defaultTheme, 'ocean')
    })

    test('logos: sube, sirve, rechaza slot o formato inválido y borra', async () => {
        const png = new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' })
        const form = () => {
            const f = new FormData()
            f.append('file', png, 'logo.png')
            return f
        }
        const post = (slot, body) =>
            fetch(`${aurora.base}/admin/api/assets/${slot}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${adminToken}` },
                body,
            })

        assert.equal((await post('logo', form())).status, 200)
        const served = await fetch(`${aurora.base}/branding/logo`)
        assert.equal(served.status, 200)
        assert.equal((await post('inexistente', form())).status, 400)

        const text = new FormData()
        text.append('file', new Blob(['hola'], { type: 'text/plain' }), 'a.txt')
        assert.ok((await post('logo', text)).status >= 400)

        await api('/admin/api/assets/logo', { method: 'DELETE' })
        assert.equal((await fetch(`${aurora.base}/branding/logo`)).status, 404)
    })
})

describe('gateway', () => {
    let gatewayToken

    test('resolve-code distingue códigos válidos', async () => {
        const post = code =>
            fetch(`${aurora.base}/api/resolve-code`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ code }),
            })
        assert.equal((await post('familia')).status, 200)
        assert.equal((await post('NOPE')).status, 404)
    })

    test('login con código: errores y éxito', async () => {
        const login = body =>
            fetch(`${aurora.base}/api/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            })
        assert.equal((await login({ username: 'demo' })).status, 400)
        assert.equal((await login({ code: 'NOPE', username: 'demo', password: 'secret' })).status, 404)
        assert.equal((await login({ code: 'FAMILIA', username: 'demo', password: 'mala' })).status, 401)

        const ok = await login({ code: ' familia ', username: 'demo', password: 'secret' })
        assert.equal(ok.status, 200)
        const body = await ok.json()
        gatewayToken = body.token
        assert.equal(body.username, 'demo')
        assert.ok(!JSON.stringify(body).includes(jelly.url), 'la URL real nunca llega al navegador')
        assert.ok(!JSON.stringify(body).includes('upstream-token'))
    })

    test('token inválido → 401', async () => {
        const res = await fetch(`${aurora.base}/jf/basura/Items`)
        assert.equal(res.status, 401)
    })

    test('JSON comprimido por el servidor llega legible, sin content-encoding y sin el nombre del motor', async () => {
        const res = await fetch(`${aurora.base}/jf/${gatewayToken}/Items`, { headers: { 'accept-encoding': 'gzip' } })
        assert.equal(res.status, 200)
        assert.equal(res.headers.get('content-encoding'), null)
        const data = await res.json()
        assert.equal(data.Items[0].Name, 'Casa FM song')
        // El token upstream se añade en el servidor, nunca viene del cliente
        assert.match(jelly.seen['/Items'].authorization, /Token="upstream-token"/)
    })

    test('audio: stream completo y Range → 206 con los bytes correctos', async () => {
        const full = await fetch(`${aurora.base}/jf/${gatewayToken}/Audio/1/universal`)
        assert.equal(full.status, 200)
        assert.deepEqual(Buffer.from(await full.arrayBuffer()), AUDIO)

        const part = await fetch(`${aurora.base}/jf/${gatewayToken}/Audio/1/universal`, { headers: { range: 'bytes=100-199' } })
        assert.equal(part.status, 206)
        assert.equal(part.headers.get('content-range'), 'bytes 100-199/1000')
        assert.deepEqual(Buffer.from(await part.arrayBuffer()), AUDIO.subarray(100, 200))
    })

    test('servidor desactivado → 410 y el token deja de servir', async () => {
        await api(`/admin/api/servers/${server.id}`, { method: 'PUT', body: { active: false } })
        const res = await fetch(`${aurora.base}/jf/${gatewayToken}/Items`)
        assert.equal(res.status, 410)
        await api(`/admin/api/servers/${server.id}`, { method: 'PUT', body: { active: true } })
    })

    test('upstream caído → 502 controlado', async () => {
        const dead = await (
            await api('/admin/api/servers', { method: 'POST', body: { jellyfinUrl: 'http://127.0.0.1:1', code: 'MUERTO' } })
        ).json()
        const res = await fetch(`${aurora.base}/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: 'MUERTO', username: 'demo', password: 'secret' }),
        })
        assert.equal(res.status, 502)
        await api(`/admin/api/servers/${dead.id}`, { method: 'DELETE' })
    })
})

describe('arranque', () => {
    test('sin ADMIN_PASSWORD genera una contraseña aleatoria segura y permite entrar', async () => {
        const solo = await startAurora({ ADMIN_PASSWORD: '' })
        try {
            const match = /password:\s+(\S+)/.exec(solo.output())
            assert.ok(match, solo.output())
            assert.ok(match[1].length >= 12)
            const { res } = await solo.adminLogin(match[1])
            assert.equal(res.status, 200)
        } finally {
            await solo.stop()
        }
    })

    test('ADMIN_PASSWORD manda: cambiarla y reiniciar con datos existentes actualiza el admin', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pw-'))
        try {
            const a = await startAurora({ ADMIN_PASSWORD: 'vieja-clave' }, { dataDir })
            assert.equal((await a.adminLogin('vieja-clave')).res.status, 200)
            await a.stop()

            const b = await startAurora({ ADMIN_PASSWORD: 'admin1234' }, { dataDir })
            try {
                assert.equal((await b.adminLogin('admin1234')).res.status, 200)
                assert.equal((await b.adminLogin('vieja-clave')).res.status, 401)
                assert.match(b.output(), /admin actualizado/)
            } finally {
                await b.stop()
            }

            // Sin la variable no se toca la contraseña guardada
            const c = await startAurora({ ADMIN_PASSWORD: '' }, { dataDir })
            try {
                assert.equal((await c.adminLogin('admin1234')).res.status, 200)
            } finally {
                await c.stop()
            }
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true })
        }
    })

    test('SANDBOX_ORIGIN=1 responde CORS solo al origen null', async () => {
        const sandbox = await startAurora({ SANDBOX_ORIGIN: '1' })
        try {
            const pre = await fetch(`${sandbox.base}/admin/api/login`, { method: 'OPTIONS', headers: { origin: 'null' } })
            assert.equal(pre.status, 204)
            assert.equal(pre.headers.get('access-control-allow-origin'), 'null')
            const other = await fetch(`${sandbox.base}/api/app-config`, { headers: { origin: 'https://evil.example' } })
            assert.equal(other.headers.get('access-control-allow-origin'), null)
        } finally {
            await sandbox.stop()
        }
    })
})
