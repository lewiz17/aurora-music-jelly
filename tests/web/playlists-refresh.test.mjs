import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

let vite
let OPTIONS

before(async () => {
    vite = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        appType: 'custom',
        server: { middlewareMode: true, hmr: false, watch: null },
        optimizeDeps: { noDiscovery: true },
    })
    ;({ PLAYLISTS_REFRESH_OPTIONS: OPTIONS } = await vite.ssrLoadModule('/src/hooks/Jellyfin/useJellyfinPlaylistsList.ts'))
})

after(async () => {
    await vite?.close()
})

const until = async (check, ms = 2000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
        if (check()) return true
        await new Promise(r => setTimeout(r, 10))
    }
    return false
}

// Same shape as the app: a QueryClient with the app's global 5 min staleTime and a cache that was
// restored from localStorage (it already holds the old list, fetched a moment ago).
const setup = ({ extra = {} } = {}) => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } } })
    client.setQueryData(['playlists'], [{ Id: '1', Name: 'Vieja' }])
    let calls = 0
    const queryFn = async () => {
        calls++
        // The admin panel created "Salsa adulta" in the meantime
        return [{ Id: '1', Name: 'Vieja' }, { Id: '2', Name: 'Salsa adulta' }]
    }
    // In the app the React provider mounts the client; that is what wires up the focus listener.
    client.mount()
    const observer = new QueryObserver(client, { queryKey: ['playlists'], queryFn, ...extra })
    const unobserve = observer.subscribe(() => {})
    const unsubscribe = () => {
        unobserve()
        client.unmount()
    }
    return { client, observer, unsubscribe, calls: () => calls }
}

test('antes: con staleTime global y caché restaurada, la lista nueva no aparecía al abrir la app', async () => {
    const { observer, unsubscribe, calls } = setup()
    await new Promise(r => setTimeout(r, 100))
    assert.equal(calls(), 0, 'no preguntó al servidor')
    assert.equal(observer.getCurrentResult().data.length, 1)
    unsubscribe()
})

test('ahora: al abrir la app se muestra lo guardado y se actualiza enseguida', async () => {
    const { observer, unsubscribe, calls } = setup({ extra: { ...OPTIONS, refetchInterval: false } })
    assert.equal(observer.getCurrentResult().data.length, 1, 'primero muestra la caché al instante')
    assert.ok(await until(() => observer.getCurrentResult().data.length === 2), 'aparece "Salsa adulta"')
    assert.equal(calls(), 1)
    unsubscribe()
})

test('ahora: al volver a la pestaña (tras crearla en el panel) se refresca', async () => {
    const { observer, unsubscribe, calls } = setup({ extra: { ...OPTIONS, refetchInterval: false } })
    assert.ok(await until(() => calls() === 1))
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    assert.ok(await until(() => calls() === 2), 'refetch al recuperar el foco, aunque acabe de refrescarse')
    assert.equal(observer.getCurrentResult().data.length, 2)
    unsubscribe()
})

test('ahora: sondea cada 30 s mientras la pestaña está visible', () => {
    assert.equal(OPTIONS.refetchInterval, 30_000)
    assert.equal(OPTIONS.staleTime, 0)
})
