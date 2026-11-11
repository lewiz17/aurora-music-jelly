import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { MemoryBackend, PgBackend } from '../src/backends.js'

let pglite

before(async () => {
    pglite = new PGlite() // real Postgres compiled to WASM, in memory
    await pglite.waitReady
})
after(async () => {
    await pglite?.close()
})

const suites = {
    'en memoria': () => new MemoryBackend(),
    'Postgres (PGlite)': () =>
        new PgBackend(async (text, params) => {
            const result = await pglite.query(text, params)
            return result.rows
        }),
}

for (const [name, make] of Object.entries(suites)) {
    describe(`contrato del almacenamiento: ${name}`, () => {
        let backend
        before(async () => {
            backend = make()
            if (backend.ready) {
                await pglite.exec('DROP TABLE IF EXISTS aurora_config, aurora_imports, aurora_attempts')
                await backend.ready()
            }
        })

        test('configuración: crear, leer y guardar con control de versión (sin pisar cambios ajenos)', async () => {
            assert.equal(await backend.loadConfig(), null)
            assert.equal(await backend.insertConfig({ settings: { a: 1 }, servers: [] }), true)
            assert.equal(await backend.insertConfig({ settings: { a: 99 } }), false, 'no sobrescribe')

            const first = await backend.loadConfig()
            assert.equal(first.version, 1)
            assert.deepEqual(first.data.settings, { a: 1 })

            assert.equal(await backend.saveConfig(1, { settings: { a: 2 }, servers: [{ id: 'x' }] }), 2)
            assert.equal(await backend.saveConfig(1, { settings: { a: 3 } }), null, 'versión vieja: conflicto')

            const second = await backend.loadConfig()
            assert.equal(second.version, 2)
            assert.deepEqual(second.data.servers, [{ id: 'x' }])
        })

        test('importaciones: guardar, reemplazar, listar por fecha y borrar', async () => {
            const tracks = Array.from({ length: 300 }, (_, i) => ({ title: `t${i}`, chosenId: `id-${i}` }))
            await backend.putImport('a', { id: 'a', tracks }, { title: 'Primera', total: 300 })
            await new Promise(r => setTimeout(r, 15))
            await backend.putImport('b', { id: 'b', tracks: [] }, { title: 'Segunda', total: 0 })

            assert.equal((await backend.getImport('a')).tracks.length, 300)
            assert.equal(await backend.getImport('nada'), null)

            await backend.putImport('a', { id: 'a', tracks: [], changed: true }, { title: 'Primera (editada)', total: 0 })
            assert.equal((await backend.getImport('a')).changed, true)

            const list = await backend.listImports()
            assert.deepEqual(
                list.map(i => i.id).sort(),
                ['a', 'b']
            )
            assert.equal(list.find(i => i.id === 'a').summary.title, 'Primera (editada)')
            assert.equal(list[0].summary.title.length > 0, true, 'el listado solo trae el resumen')

            await backend.deleteImport('a')
            assert.equal(await backend.getImport('a'), null)
        })

        test('intentos: cuenta fallos, bloquea al llegar al máximo, caduca y se limpia con un acierto', async () => {
            const key = 'ip-1'
            assert.deepEqual(await backend.attempts.check(key, 3), { blocked: false, retryAfter: 0 })
            await backend.attempts.fail(key, 60_000)
            await backend.attempts.fail(key, 60_000)
            assert.equal((await backend.attempts.check(key, 3)).blocked, false)
            await backend.attempts.fail(key, 60_000)
            const blocked = await backend.attempts.check(key, 3)
            assert.equal(blocked.blocked, true)
            assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60)
            assert.equal((await backend.attempts.check('otra-ip', 3)).blocked, false, 'claves independientes')

            await backend.attempts.clear(key)
            assert.equal((await backend.attempts.check(key, 3)).blocked, false)

            // ventana corta: caduca sola
            await backend.attempts.fail('corta', 200)
            await backend.attempts.fail('corta', 200)
            assert.equal((await backend.attempts.check('corta', 2)).blocked, true)
            await new Promise(r => setTimeout(r, 350))
            assert.equal((await backend.attempts.check('corta', 2)).blocked, false)
            await backend.attempts.fail('corta', 200)
            assert.equal((await backend.attempts.check('corta', 2)).blocked, false, 'tras caducar, el contador empieza de nuevo')
        })
    })
}
