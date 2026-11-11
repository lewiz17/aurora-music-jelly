import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { selectPlaylistIds } from '../src/match.js'
import { startAurora, startFakeJellyfin } from './harness.js'

const track = (chosenId, status = 'auto') => ({ title: `t-${chosenId}`, artist: 'a', chosenId, status, candidates: [] })

test('selectPlaylistIds: respeta el orden, omite repetidas y no añade las «no encontradas»', () => {
    const { ids, duplicates, excluded } = selectPlaylistIds([
        track('a'),
        track('b', 'review'),
        track('a'), // la misma canción de la biblioteca otra vez
        track('c', 'none'), // resto de una versión antigua: tenía chosenId pese a «no encontrada»
        track(null, 'none'),
        track('d'),
        track('b'),
    ])
    assert.deepEqual(ids, ['a', 'b', 'd'])
    assert.equal(duplicates, 2)
    assert.equal(excluded, 2)
    assert.deepEqual(selectPlaylistIds(undefined), { ids: [], duplicates: 0, excluded: 0 })
})

// ---- crear lista desde el panel contra un Jellyfin simulado ----
let jelly
let aurora
let dataDir
let token

before(async () => {
    jelly = await startFakeJellyfin()
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-imp-'))

    // 130 pistas: 100 únicas emparejadas + 15 repetidas + 10 «no encontradas» con resto de chosenId + 5 sin nada
    const tracks = []
    for (let i = 0; i < 100; i++) tracks.push(track(`item-${String(i).padStart(3, '0')}`))
    for (let i = 0; i < 15; i++) tracks.push(track(`item-${String(i * 2).padStart(3, '0')}`))
    for (let i = 0; i < 10; i++) tracks.push(track(`wrong-${i}`, 'none'))
    for (let i = 0; i < 5; i++) tracks.push(track(null, 'none'))

    fs.writeFileSync(
        path.join(dataDir, 'aurora.json'),
        JSON.stringify({
            version: 1,
            servers: [{ id: 'srv-1', code: 'FAMILIA', jellyfinUrl: jelly.url, apiKey: 'k', label: 'x', active: true }],
            imports: {
                imp1: { title: 'Salsa adulta', sourceUrl: 'u', serverId: 'srv-1', createdAt: new Date().toISOString(), tracks },
            },
        })
    )

    aurora = await startAurora({}, { dataDir })
    token = (await aurora.adminLogin()).body.token
})

after(async () => {
    await aurora?.stop()
    await jelly?.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
})

const api = (p, init = {}) =>
    fetch(`${aurora.base}${p}`, {
        ...init,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: init.body ? JSON.stringify(init.body) : undefined,
    })

test('GET de una importación devuelve siempre su id (el panel arma las URLs con él)', async () => {
    const detail = await (await api('/admin/api/imports/imp1')).json()
    assert.equal(detail.id, 'imp1')
})

test('el historial muestra la lista sin marcar como creada', async () => {
    const { imports } = await (await api('/admin/api/state')).json()
    assert.equal(imports.length, 1)
    assert.equal(imports[0].total, 130)
    assert.equal(imports[0].applied, null)
})

test('crear lista: orden de YouTube Music, sin repetidas ni «no encontradas», en trozos pequeños', async () => {
    const res = await api('/admin/api/imports/imp1/apply', {
        method: 'POST',
        body: { serverId: 'srv-1', playlistName: 'Salsa adulta', mode: 'create' },
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.added, 100)
    assert.equal(body.duplicates, 15)
    assert.equal(body.excluded, 15)

    const [playlist] = jelly.playlists
    assert.equal(playlist.name, 'Salsa adulta')
    const sent = playlist.adds.flatMap(a => a.ids)
    assert.deepEqual(sent, Array.from({ length: 100 }, (_, i) => `item-${String(i).padStart(3, '0')}`))
    assert.equal(new Set(sent).size, sent.length, 'ningún id repetido')
    assert.ok(!sent.some(id => id.startsWith('wrong-')))
    assert.ok(playlist.adds.length >= 2, 'se envía en varios trozos')
    assert.ok(Math.max(...playlist.adds.map(a => a.ids.length)) <= 50)
    assert.ok(Math.max(...playlist.adds.map(a => a.urlLength)) < 3000, 'URLs cortas, aptas para proxies')
})

test('tras crearla, el historial la marca como creada (y se puede volver a abrir)', async () => {
    const { imports } = await (await api('/admin/api/state')).json()
    assert.equal(imports[0].applied.count, 100)
    const detail = await (await api('/admin/api/imports/imp1')).json()
    assert.equal(detail.tracks.length, 130)
})

test('sin pistas elegibles no se crea nada', async () => {
    await api('/admin/api/imports/imp1', {
        method: 'PUT',
        body: { overrides: Object.fromEntries(Array.from({ length: 130 }, (_, i) => [i, null])) },
    })
    const before = jelly.playlists.length
    const res = await api('/admin/api/imports/imp1/apply', { method: 'POST', body: { serverId: 'srv-1' } })
    assert.equal(res.status, 400)
    assert.equal(jelly.playlists.length, before)
})

test('elegir a mano una «no encontrada» sí la incluye', async () => {
    await api('/admin/api/imports/imp1', { method: 'PUT', body: { overrides: { 0: 'manual-1' } } })
    const res = await api('/admin/api/imports/imp1/apply', { method: 'POST', body: { serverId: 'srv-1' } })
    assert.equal((await res.json()).added, 1)
    assert.deepEqual(jelly.playlists.at(-1).adds.flatMap(a => a.ids), ['manual-1'])
})
