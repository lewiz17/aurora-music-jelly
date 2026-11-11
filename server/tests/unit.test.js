import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// config.js reads the environment on import: point it at a throwaway dir first.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-unit-'))
process.env.DATA_DIR = dataDir
process.env.SESSION_SECRET = 'unit-secret'

const { classify, mapLimit, normalize, scoreCandidate, similarity } = await import('../src/match.js')
const { createSessionToken, readSessionToken, makeAdminToken, verifyAdminSignature, signAdmin } = await import(
    '../src/session.js'
)
const { Store, generateCode, normalizeCode } = await import('../src/store.js')
const { parseYtInput } = await import('../src/ytmusic.js')

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

test('match: normaliza acentos, ruido y feat.', () => {
    assert.equal(normalize('Canción (Official Video)'), 'cancion')
    assert.equal(normalize('Song - Topic'), 'song')
    assert.equal(normalize('Tema feat. Alguien'), 'tema')
    assert.equal(similarity('Hola', 'hola'), 1)
    assert.equal(similarity('', 'x'), 0)
})

test('match: mismo artista se empareja solo, otro artista nunca es automático', () => {
    const yt = { title: 'Bailando', artist: 'Enrique Iglesias', duration: '4:03' }
    const good = { Name: 'Bailando', Artists: ['Enrique Iglesias'], RunTimeTicks: 243 * 10_000_000 }
    const cover = { Name: 'Bailando', Artists: ['Karaoke Hits'], RunTimeTicks: 243 * 10_000_000 }
    assert.equal(classify(scoreCandidate(yt, good)), 'auto')
    assert.notEqual(classify(scoreCandidate(yt, cover)), 'auto')
})

test('match: classify respeta los umbrales', () => {
    assert.equal(classify(0.72), 'auto')
    assert.equal(classify(0.5), 'review')
    assert.equal(classify(0.1), 'none')
})

test('match: mapLimit conserva el orden y limita la concurrencia', async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async n => {
        active++
        peak = Math.max(peak, active)
        await new Promise(r => setTimeout(r, 5))
        active--
        return n * 2
    })
    assert.deepEqual(out, [2, 4, 6, 8, 10, 12])
    assert.ok(peak <= 2)
})

test('session: el token del gateway viaja cifrado y detecta manipulación', () => {
    const token = createSessionToken({ serverId: 's1', upstreamToken: 'secret-upstream', userId: 'u1' })
    assert.ok(!Buffer.from(token, 'base64url').toString('utf8').includes('secret-upstream'))
    assert.equal(readSessionToken(token).upstreamToken, 'secret-upstream')
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA')
    assert.equal(readSessionToken(tampered), null)
    assert.equal(readSessionToken('basura'), null)
    assert.equal(readSessionToken(undefined), null)
})

test('session: el token de admin se valida, y caduca o se rechaza si está alterado', () => {
    assert.equal(verifyAdminSignature(makeAdminToken()).role, 'admin')
    const expired = signAdmin(Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() - 1 })).toString('base64url'))
    assert.equal(verifyAdminSignature(expired), null)
    assert.equal(verifyAdminSignature(makeAdminToken() + 'x'), null)
    assert.equal(verifyAdminSignature(undefined), null)
    assert.equal(verifyAdminSignature(''), null)
})

test('store: códigos normalizados, únicos (también inactivos) y sin caracteres ambiguos', () => {
    assert.equal(normalizeCode('  casa 2026 '), 'CASA-2026')
    assert.match(generateCode(8), /^[A-HJKMNP-Z2-9]{8}$/)

    const a = Store.addServer({ jellyfinUrl: 'http://x:8096///', label: 'A', code: 'familia' })
    assert.equal(a.code, 'FAMILIA')
    assert.equal(a.jellyfinUrl, 'http://x:8096')
    assert.ok(Store.findByCode('familia'))

    Store.updateServer(a.id, { active: false })
    assert.equal(Store.findByCode('FAMILIA'), null, 'un código inactivo no permite entrar')
    assert.equal(Store.codeInUse('familia'), true, 'pero sigue ocupando el código')
    assert.equal(Store.codeInUse('familia', a.id), false)
    Store.removeServer(a.id)
    assert.equal(Store.codeInUse('familia'), false)
})

test('store: verifica la contraseña del admin con hash', () => {
    Store.setAdmin('admin', 'clave-larga')
    assert.equal(Store.verifyAdmin('admin', 'clave-larga'), true)
    assert.equal(Store.verifyAdmin('admin', 'otra'), false)
    assert.equal(Store.verifyAdmin('otro', 'clave-larga'), false)
    assert.ok(!JSON.stringify(Store.data.admin).includes('clave-larga'))
})

test('ytmusic: reconoce URLs y ids', () => {
    assert.deepEqual(parseYtInput('https://music.youtube.com/playlist?list=PLabc_123'), { type: 'playlist', id: 'PLabc_123' })
    assert.deepEqual(parseYtInput('https://music.youtube.com/watch?v=dQw4w9WgXcQ'), { type: 'song', id: 'dQw4w9WgXcQ' })
    assert.deepEqual(parseYtInput('VLPLabc'), { type: 'playlist', id: 'PLabc' })
    assert.equal(parseYtInput(''), null)
    assert.equal(parseYtInput('hola'), null)
})
