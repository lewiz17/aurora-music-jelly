import { THEMES } from '../../server/src/themes.js'
import { MemoryBackend, PgBackend, neonQuery } from './backends.js'

export { THEMES }

// Same defaults as server/src/store.js
export const DEFAULT_CONFIG = {
    settings: {
        brandName: 'Aurora Music',
        defaultTheme: 'aurora',
        defaultLanguage: 'es',
        codeFieldLabel: 'Código de acceso',
        codeFieldPlaceholder: 'Escribe el código que te compartieron',
        hideAbout: true,
    },
    servers: [],
    assets: {},
    // Jellyfin admin sessions used by the importer, encrypted (see crypto.sealJson)
    jfSessions: {},
}

export const normalizeCode = code =>
    String(code || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '-')

// Short, unambiguous code (no 0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const generateCode = (length = 6) => {
    const bytes = crypto.getRandomValues(new Uint8Array(length))
    let out = ''
    for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
    return out
}

const CONFIG_CACHE_MS = 15_000
const MAX_WRITE_RETRIES = 4

/** Summary shown in the "Importaciones" list, kept next to each import so listing stays cheap. */
export const summarizeImport = record => {
    const tracks = record.tracks || []
    const count = status => tracks.filter(track => track.status === status).length
    return {
        title: record.title,
        sourceUrl: record.sourceUrl,
        createdAt: record.createdAt,
        total: tracks.length,
        matched: count('auto'),
        review: count('review'),
        missing: count('none'),
        pending: count('pending'),
        reading: Boolean(record.continuation),
        applied: record.applied ? { at: record.applied.at, count: record.applied.count } : null,
    }
}

/**
 * Async store on top of a backend. The small config (settings, servers, asset names) is cached per
 * isolate for a few seconds, so serving audio never waits on the database; writes always re-read the
 * latest version first and fail over to a retry if another isolate wrote in between.
 */
export class Store {
    #backend
    #cache = null

    constructor(backend) {
        this.#backend = backend
    }

    get attempts() {
        return this.#backend.attempts
    }

    async #fresh() {
        let row = await this.#backend.loadConfig()
        if (!row) {
            await this.#backend.insertConfig(DEFAULT_CONFIG)
            row = await this.#backend.loadConfig()
        }
        // rows written by older versions may lack newer keys
        const data = {
            ...structuredClone(DEFAULT_CONFIG),
            ...row.data,
            settings: { ...DEFAULT_CONFIG.settings, ...(row.data.settings || {}) },
        }
        return { version: row.version, data }
    }

    /** Cached read for hot paths (gateway requests). */
    async config() {
        if (this.#cache && Date.now() - this.#cache.at < CONFIG_CACHE_MS) return this.#cache.data
        const row = await this.#fresh()
        this.#cache = { data: row.data, at: Date.now() }
        return row.data
    }

    /** Uncached read, for the admin panel (a stale view right after saving would look like a bug). */
    async snapshot() {
        return (await this.#fresh()).data
    }

    /** Read-modify-write with optimistic concurrency. `mutate` receives a copy and may return a value. */
    async update(mutate) {
        for (let attempt = 0; attempt < MAX_WRITE_RETRIES; attempt++) {
            const { version, data } = await this.#fresh()
            const result = await mutate(data)
            const next = await this.#backend.saveConfig(version, data)
            if (next !== null) {
                this.#cache = { data, at: Date.now() }
                return result
            }
        }
        throw new Error('No se pudo guardar: hay otro cambio simultáneo. Inténtalo de nuevo.')
    }

    // ---------- servers ----------
    async findByCode(code) {
        if (!code) return null
        const wanted = normalizeCode(code)
        const { servers } = await this.config()
        return servers.find(s => normalizeCode(s.code) === wanted && s.active !== false) || null
    }

    async findById(id) {
        const { servers } = await this.config()
        return servers.find(s => s.id === id) || null
    }

    /** Counts deactivated servers too: a code must stay unique. */
    async codeInUse(code, exceptId) {
        const wanted = normalizeCode(code)
        if (!wanted) return false
        const { servers } = await this.#fresh().then(r => r.data)
        return servers.some(s => s.id !== exceptId && normalizeCode(s.code) === wanted)
    }

    addServer({ jellyfinUrl, label, code }) {
        return this.update(data => {
            const server = {
                id: crypto.randomUUID(),
                code: normalizeCode(code || generateCode()),
                jellyfinUrl: String(jellyfinUrl || '').replace(/\/+$/, ''),
                label: label || 'Mi servidor',
                createdAt: new Date().toISOString(),
                active: true,
            }
            data.servers.push(server)
            return server
        })
    }

    updateServer(id, patch) {
        return this.update(data => {
            const server = data.servers.find(s => s.id === id)
            if (!server) return null
            const clean = Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined))
            Object.assign(server, clean)
            if (clean.code) server.code = normalizeCode(clean.code)
            if (clean.jellyfinUrl) server.jellyfinUrl = String(clean.jellyfinUrl).replace(/\/+$/, '')
            return structuredClone(server)
        })
    }

    removeServer(id) {
        return this.update(data => {
            data.servers = data.servers.filter(s => s.id !== id)
        })
    }

    // ---------- settings & assets ----------
    updateSettings(patch) {
        return this.update(data => {
            data.settings = { ...data.settings, ...patch }
            return structuredClone(data.settings)
        })
    }

    setAsset(slot, key) {
        return this.update(data => {
            const previous = data.assets[slot] || null
            data.assets[slot] = key
            return previous
        })
    }

    removeAsset(slot) {
        return this.update(data => {
            const previous = data.assets[slot] || null
            delete data.assets[slot]
            return previous
        })
    }

    // ---------- Jellyfin admin sessions (encrypted by the caller) ----------
    setJfSession(serverUrl, sealed) {
        return this.update(data => {
            data.jfSessions[serverUrl] = sealed
        })
    }

    async getJfSession(serverUrl) {
        const { data } = await this.#fresh()
        return data.jfSessions[serverUrl] || null
    }

    // ---------- imports ----------
    getImport(id) {
        return this.#backend.getImport(id)
    }

    saveImport(record) {
        return this.#backend.putImport(record.id, record, summarizeImport(record))
    }

    deleteImport(id) {
        return this.#backend.deleteImport(id)
    }

    async listImports() {
        const rows = await this.#backend.listImports()
        return rows.map(({ id, summary }) => ({ id, ...summary }))
    }
}

// ---------------------------------------------------------------------------
// Wiring from the Worker environment
// ---------------------------------------------------------------------------
// Keyed by something stable (the connection string), not by the `env` object: Workers do not
// promise to pass the same `env` object on every request, and a new Store per request would lose
// the config cache and re-run the schema check each time.
const storeCache = new Map()

/** Test/dev hooks: `env.AURORA_BACKEND` (an object) or `env.STORE === 'memory'`. Production: DATABASE_URL. */
export const getStore = async env => {
    const key = env.AURORA_BACKEND || env.DATABASE_URL || (env.STORE === 'memory' ? 'memory' : null)
    if (!key) {
        throw Object.assign(new Error('Falta DATABASE_URL (cadena de conexión de Neon).'), { code: 'not_configured' })
    }
    let store = storeCache.get(key)
    if (store) return store
    let backend = env.AURORA_BACKEND
    if (!backend && env.DATABASE_URL) backend = new PgBackend(await neonQuery(env.DATABASE_URL))
    if (!backend) backend = new MemoryBackend()
    store = new Store(backend)
    storeCache.set(key, store)
    return store
}
