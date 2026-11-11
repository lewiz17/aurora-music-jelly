import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createLimiter } from '../src/ratelimit.js'
import { startAurora, startFakeJellyfin } from './harness.js'

test('limiter: bloquea al llegar al máximo de fallos y se libera al caducar la ventana', async () => {
    const limiter = createLimiter({ windowMs: 80, max: 3 })
    for (let i = 0; i < 2; i++) limiter.fail('a')
    assert.equal(limiter.blocked('a'), false)
    limiter.fail('a')
    assert.equal(limiter.blocked('a'), true)
    assert.equal(limiter.blocked('b'), false, 'las claves son independientes')
    assert.ok(limiter.retryAfterSeconds('a') >= 1)
    await new Promise(r => setTimeout(r, 120))
    assert.equal(limiter.blocked('a'), false, 'la ventana caducó')
})

test('limiter: un acierto limpia los fallos acumulados', () => {
    const limiter = createLimiter({ windowMs: 10_000, max: 3 })
    limiter.fail('a')
    limiter.fail('a')
    limiter.clear('a')
    limiter.fail('a')
    limiter.fail('a')
    assert.equal(limiter.blocked('a'), false)
})

test('TRUST_PROXY: interpreta saltos, desactivado y listas de IPs', async () => {
    process.env.DATA_DIR = (await import('node:os')).tmpdir() // config.js crea la carpeta al importarse
    const { parseTrustProxy } = await import('../src/config.js')
    assert.equal(parseTrustProxy(undefined), 1)
    assert.equal(parseTrustProxy(''), 1)
    assert.equal(parseTrustProxy('2'), 2)
    assert.equal(parseTrustProxy('0'), false)
    assert.equal(parseTrustProxy('false'), false)
    assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8')
})

describe('límite por cliente detrás de un proxy', () => {
    const attempt = async (aurora, forwardedFor) => {
        const res = await fetch(`${aurora.base}/admin/api/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-forwarded-for': forwardedFor },
            body: JSON.stringify({ username: 'admin', password: 'mala' }),
        })
        return res.status
    }

    test('TRUST_PROXY=1: cada cliente real (X-Forwarded-For) tiene su propio contador', async () => {
        const aurora = await startAurora({ LOGIN_MAX_FAILURES: '2', TRUST_PROXY: '1' })
        try {
            assert.equal(await attempt(aurora, '1.1.1.1'), 401)
            assert.equal(await attempt(aurora, '1.1.1.1'), 401)
            assert.equal(await attempt(aurora, '1.1.1.1'), 429, 'ese cliente queda bloqueado')
            assert.equal(await attempt(aurora, '2.2.2.2'), 401, 'otro cliente no se ve afectado')
        } finally {
            await aurora.stop()
        }
    })

    test('TRUST_PROXY=0: se ignora X-Forwarded-For (no se puede esquivar el límite falsificándolo)', async () => {
        const aurora = await startAurora({ LOGIN_MAX_FAILURES: '2', TRUST_PROXY: '0' })
        try {
            assert.equal(await attempt(aurora, '1.1.1.1'), 401)
            assert.equal(await attempt(aurora, '2.2.2.2'), 401)
            assert.equal(await attempt(aurora, '3.3.3.3'), 429, 'misma IP real: comparten contador')
        } finally {
            await aurora.stop()
        }
    })
})

describe('en el servidor (máx. 3 fallos)', () => {
    let aurora
    let jelly

    before(async () => {
        jelly = await startFakeJellyfin()
        aurora = await startAurora({ LOGIN_MAX_FAILURES: '3', LOGIN_WINDOW_MS: '60000', FRAME_ANCESTORS: "'self'" })
    })
    after(async () => {
        await aurora?.stop()
        await jelly?.close()
    })

    const post = (path, body) =>
        fetch(`${aurora.base}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })

    test('panel: 3 contraseñas malas → 429 con Retry-After, y entonces ni la correcta entra', async () => {
        for (let i = 0; i < 3; i++) assert.equal((await aurora.adminLogin('mala')).res.status, 401)
        const blocked = await aurora.adminLogin('mala')
        assert.equal(blocked.res.status, 429)
        assert.ok(Number(blocked.res.headers.get('retry-after')) >= 1)
        assert.equal(blocked.body.error, 'too_many_attempts')
        assert.equal((await aurora.adminLogin('test1234')).res.status, 429)
    })

    test('gateway: los aciertos no cuentan; los fallos de credenciales bloquean antes de llegar a Jellyfin', async () => {
        // El panel de la prueba anterior quedó bloqueado para esta IP: servidor limpio con el código creado
        await aurora.stop()
        aurora = await startAurora({ LOGIN_MAX_FAILURES: '3', LOGIN_WINDOW_MS: '60000' })
        const { body } = await aurora.adminLogin()
        await fetch(`${aurora.base}/admin/api/servers`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${body.token}` },
            body: JSON.stringify({ jellyfinUrl: jelly.url, code: 'FAMILIA' }),
        })

        const good = { code: 'FAMILIA', username: 'demo', password: 'secret' }
        const bad = { code: 'FAMILIA', username: 'demo', password: 'mala' }

        // 6 inicios de sesión correctos seguidos: no bloquean (sólo cuentan los fallos)
        for (let i = 0; i < 6; i++) assert.equal((await post('/api/login', good)).status, 200)

        for (let i = 0; i < 3; i++) assert.equal((await post('/api/login', bad)).status, 401)
        const blocked = await post('/api/login', bad)
        assert.equal(blocked.status, 429)
        const attempts = jelly.hits['/Users/AuthenticateByName']
        assert.equal((await post('/api/login', good)).status, 429, 'bloqueado también para la contraseña correcta')
        assert.equal(jelly.hits['/Users/AuthenticateByName'], attempts, 'ya no se reenvía ningún intento a Jellyfin')
    })

    test('gateway: sondear códigos inexistentes también bloquea', async () => {
        await aurora.stop()
        aurora = await startAurora({ LOGIN_MAX_FAILURES: '3', LOGIN_WINDOW_MS: '60000' })
        for (let i = 0; i < 3; i++) assert.equal((await post('/api/resolve-code', { code: `NOPE${i}` })).status, 404)
        assert.equal((await post('/api/resolve-code', { code: 'NOPE9' })).status, 429)
    })

    test('FRAME_ANCESTORS=\'self\' impide incrustar la app y el panel en otros sitios', async () => {
        await aurora.stop()
        aurora = await startAurora({ FRAME_ANCESTORS: "'self'" })
        for (const path of ['/', '/admin']) {
            const res = await fetch(`${aurora.base}${path}`)
            assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'self'")
            assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN')
        }
    })
})
