import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let vite
let getAllTracks

before(async () => {
    // Loads the real TypeScript module (no copy of its logic in the test).
    vite = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        appType: 'custom',
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true },
    })
    ;({ getAllTracks } = await vite.ssrLoadModule('/src/utils/getAllTracks.ts'))
})

after(async () => {
    await vite?.close()
})

const item = Id => ({ Id, Name: `song ${Id}`, Type: 'Audio' })

// A playlist with the same track twice (e.g. two YouTube Music rows matched one library song).
const pages = { pageParams: [0], pages: [[item('A'), item('B'), item('A'), item('C'), item('D')]] }

test('getAllTracks quita repetidas por defecto y las conserva con allowDuplicates', () => {
    assert.deepEqual(getAllTracks(pages).map(t => t.Id), ['A', 'B', 'C', 'D'])
    assert.deepEqual(getAllTracks(pages, true).map(t => t.Id), ['A', 'B', 'A', 'C', 'D'])
})

test('con repetidas, la lista visible desalineada reproduce una pista anterior (el fallo)', () => {
    const queue = getAllTracks(pages, true) // la cola de reproducción conserva duplicados
    const visibleDeduped = getAllTracks(pages) // lo que mostraba la página de la lista
    const clicked = visibleDeduped.findIndex(t => t.Id === 'D') // fila 3 en pantalla
    assert.equal(queue[clicked].Id, 'C', 'sonaba «C» al pulsar «D»')
})

test('si la lista visible usa la misma regla que la cola, cada fila reproduce su pista', () => {
    const queue = getAllTracks(pages, true)
    const visible = getAllTracks(pages, true)
    visible.forEach((track, index) => assert.equal(queue[index].Id, track.Id))
})

test('la página de la lista de reproducción pide conservar las repetidas', () => {
    const source = fs.readFileSync(path.join(root, 'src/hooks/Jellyfin/Infinite/useJellyfinPlaylistData.ts'), 'utf8')
    assert.match(source, /allowDuplicates:\s*true/)
})
