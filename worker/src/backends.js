/**
 * Storage backends. Both implement the same contract (see worker/tests/backend.test.js, which runs
 * one suite against both):
 *
 *   loadConfig()                      -> { version, data } | null
 *   insertConfig(data)                -> boolean              (false if a row already exists)
 *   saveConfig(expectedVersion, data) -> newVersion | null    (null = someone else wrote first)
 *   getImport(id) / putImport(id, record, summary) / deleteImport(id) / listImports()
 *   attempts.check(key, max)          -> { blocked, retryAfter }
 *   attempts.fail(key, windowMs) / attempts.clear(key)
 *
 * Why not a single JSON document like the Node server? Workers run in many short-lived isolates
 * with no shared memory or disk, so state has to live in a database. Imports (hundreds of tracks
 * with candidates) are kept apart from the small config so every gateway request stays cheap.
 */

const asJson = value => (typeof value === 'string' ? JSON.parse(value) : value)

// ---------------------------------------------------------------------------
// In memory: development (`STORE=memory`) and unit tests. Lost when the isolate restarts.
// ---------------------------------------------------------------------------
export class MemoryBackend {
    #config = null
    #imports = new Map()
    #attempts = new Map()

    async loadConfig() {
        return this.#config ? { version: this.#config.version, data: structuredClone(this.#config.data) } : null
    }

    async insertConfig(data) {
        if (this.#config) return false
        this.#config = { version: 1, data: structuredClone(data) }
        return true
    }

    async saveConfig(expectedVersion, data) {
        if (!this.#config || this.#config.version !== expectedVersion) return null
        this.#config = { version: expectedVersion + 1, data: structuredClone(data) }
        return this.#config.version
    }

    async getImport(id) {
        const row = this.#imports.get(id)
        return row ? structuredClone(row.record) : null
    }

    async putImport(id, record, summary) {
        this.#imports.set(id, { record: structuredClone(record), summary: structuredClone(summary) })
    }

    async deleteImport(id) {
        this.#imports.delete(id)
    }

    async listImports() {
        return [...this.#imports].map(([id, row]) => ({ id, summary: structuredClone(row.summary) }))
    }

    attempts = {
        check: async (key, max) => {
            const entry = this.#attempts.get(key)
            if (!entry || entry.reset <= Date.now()) return { blocked: false, retryAfter: 0 }
            return { blocked: entry.count >= max, retryAfter: Math.max(1, Math.ceil((entry.reset - Date.now()) / 1000)) }
        },
        fail: async (key, windowMs) => {
            const entry = this.#attempts.get(key)
            if (!entry || entry.reset <= Date.now()) this.#attempts.set(key, { count: 1, reset: Date.now() + windowMs })
            else entry.count++
        },
        clear: async key => {
            this.#attempts.delete(key)
        },
    }
}

// ---------------------------------------------------------------------------
// Postgres (Neon). `query(text, params)` must resolve to an array of rows.
// ---------------------------------------------------------------------------
const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS aurora_config (
        id integer PRIMARY KEY,
        version integer NOT NULL,
        data jsonb NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS aurora_imports (
        id text PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        summary jsonb NOT NULL,
        data jsonb NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS aurora_attempts (
        key text PRIMARY KEY,
        count integer NOT NULL,
        reset_at timestamptz NOT NULL
    )`,
]

export class PgBackend {
    #query
    #ready

    constructor(query) {
        this.#query = query
    }

    /** Creates the tables the first time an isolate touches the database. */
    ready() {
        this.#ready ??= (async () => {
            for (const statement of SCHEMA) await this.#query(statement, [])
        })().catch(error => {
            this.#ready = undefined // let the next request retry
            throw error
        })
        return this.#ready
    }

    async #run(text, params = []) {
        await this.ready()
        return this.#query(text, params)
    }

    async loadConfig() {
        const rows = await this.#run('SELECT version, data FROM aurora_config WHERE id = 1')
        return rows[0] ? { version: Number(rows[0].version), data: asJson(rows[0].data) } : null
    }

    async insertConfig(data) {
        const rows = await this.#run(
            'INSERT INTO aurora_config (id, version, data) VALUES (1, 1, $1::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id',
            [JSON.stringify(data)]
        )
        return rows.length > 0
    }

    async saveConfig(expectedVersion, data) {
        const rows = await this.#run(
            'UPDATE aurora_config SET data = $1::jsonb, version = version + 1 WHERE id = 1 AND version = $2 RETURNING version',
            [JSON.stringify(data), expectedVersion]
        )
        return rows[0] ? Number(rows[0].version) : null
    }

    async getImport(id) {
        const rows = await this.#run('SELECT data FROM aurora_imports WHERE id = $1', [id])
        return rows[0] ? asJson(rows[0].data) : null
    }

    async putImport(id, record, summary) {
        await this.#run(
            `INSERT INTO aurora_imports (id, summary, data) VALUES ($1, $2::jsonb, $3::jsonb)
             ON CONFLICT (id) DO UPDATE SET summary = EXCLUDED.summary, data = EXCLUDED.data`,
            [id, JSON.stringify(summary), JSON.stringify(record)]
        )
    }

    async deleteImport(id) {
        await this.#run('DELETE FROM aurora_imports WHERE id = $1', [id])
    }

    async listImports() {
        const rows = await this.#run('SELECT id, summary FROM aurora_imports ORDER BY created_at DESC')
        return rows.map(row => ({ id: row.id, summary: asJson(row.summary) }))
    }

    attempts = {
        check: async (key, max) => {
            const rows = await this.#run(
                `SELECT count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (reset_at - now()))))::int AS retry
                 FROM aurora_attempts WHERE key = $1 AND reset_at > now()`,
                [key]
            )
            if (!rows[0]) return { blocked: false, retryAfter: 0 }
            return { blocked: Number(rows[0].count) >= max, retryAfter: Number(rows[0].retry) }
        },
        fail: async (key, windowMs) => {
            await this.#run(
                `INSERT INTO aurora_attempts (key, count, reset_at)
                 VALUES ($1, 1, now() + ($2::int * interval '1 millisecond'))
                 ON CONFLICT (key) DO UPDATE SET
                     count = CASE WHEN aurora_attempts.reset_at > now() THEN aurora_attempts.count + 1 ELSE 1 END,
                     reset_at = CASE WHEN aurora_attempts.reset_at > now() THEN aurora_attempts.reset_at
                                     ELSE now() + ($2::int * interval '1 millisecond') END`,
                [key, windowMs]
            )
        },
        clear: async key => {
            await this.#run('DELETE FROM aurora_attempts WHERE key = $1', [key])
        },
    }
}

/** Neon over HTTP: one fetch per query, no connection to keep alive (fits Workers). */
export const neonQuery = async databaseUrl => {
    const { neon } = await import('@neondatabase/serverless')
    const sql = neon(databaseUrl)
    return async (text, params = []) => sql.query(text, params)
}
