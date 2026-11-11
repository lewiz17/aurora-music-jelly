import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

// server/src/session.js reads its secret and data dir from the environment at import time
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-worker-crypto-'))
process.env.DATA_DIR = dataDir
process.env.SESSION_SECRET = 'secreto-compartido'

const node = await import('../../server/src/session.js')
const worker = await import('../src/crypto.js')
const SECRET = 'secreto-compartido'

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))

test('token de gateway: el servidor Node y el Worker se entienden en los dos sentidos', async () => {
    const payload = { serverId: 's1', upstreamToken: 'upstream-secreto', userId: 'u1', username: 'ana' }

    const fromNode = node.createSessionToken(payload)
    assert.equal((await worker.readSessionToken(SECRET, fromNode)).upstreamToken, 'upstream-secreto')

    const fromWorker = await worker.createSessionToken(SECRET, payload)
    assert.equal(node.readSessionToken(fromWorker).username, 'ana')
})

test('token de gateway: va cifrado, con otra clave no se abre y detecta manipulación', async () => {
    const token = await worker.createSessionToken(SECRET, { serverId: 's', upstreamToken: 'visible-si-no-cifra' })
    assert.ok(!Buffer.from(token, 'base64url').toString('utf8').includes('visible-si-no-cifra'))
    assert.equal(await worker.readSessionToken('otra-clave', token), null)

    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA')
    assert.equal(await worker.readSessionToken(SECRET, tampered), null)
    assert.equal(await worker.readSessionToken(SECRET, 'basura'), null)
    assert.equal(await worker.readSessionToken(SECRET, undefined), null)
    assert.equal(await worker.readSessionToken(SECRET, await worker.createSessionToken(SECRET, { nada: 1 })), null)
})

test('token de admin: compatible con Node, caduca y rechaza firmas alteradas', async () => {
    assert.equal((await worker.verifyAdminToken(SECRET, node.makeAdminToken())).role, 'admin')
    assert.equal(node.verifyAdminSignature(await worker.makeAdminToken(SECRET)).role, 'admin')

    const expired = node.signAdmin(Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() - 1 })).toString('base64url'))
    assert.equal(await worker.verifyAdminToken(SECRET, expired), null)
    assert.equal(await worker.verifyAdminToken(SECRET, (await worker.makeAdminToken(SECRET)) + 'x'), null)
    assert.equal(await worker.verifyAdminToken('otra-clave', await worker.makeAdminToken(SECRET)), null)
    for (const bad of [undefined, '', 'sin-punto', '.', 'a.b']) assert.equal(await worker.verifyAdminToken(SECRET, bad), null)
})

test('datos guardados: cifrado propio, no intercambiable con los tokens del gateway', async () => {
    const sealed = await worker.sealJson(SECRET, { token: 'jf-admin', userId: 'u' })
    assert.deepEqual(await worker.openJson(SECRET, sealed), { token: 'jf-admin', userId: 'u' })
    assert.equal(await worker.openJson('otra-clave', sealed), null)
    // un token de gateway no vale como dato guardado, ni al revés
    assert.equal(await worker.openJson(SECRET, await worker.createSessionToken(SECRET, { serverId: 's', upstreamToken: 't' })), null)
    assert.equal(await worker.readSessionToken(SECRET, sealed), null)
})

test('safeEqual: compara sin filtrar la longitud', async () => {
    assert.equal(await worker.safeEqual('clave', 'clave'), true)
    assert.equal(await worker.safeEqual('clave', 'clavE'), false)
    assert.equal(await worker.safeEqual('a', 'a'.repeat(5000)), false)
    assert.equal(await worker.safeEqual('', ''), true)
})
