import pg from 'pg'
import { config } from './config.js'

/**
 * Persistencia opcional en Postgres (Fase 1).
 *
 * Sólo se activa si existe DATABASE_URL (sirve cualquier Postgres: Neon,
 * Supabase vía pooler, uno propio...). Guarda dos cosas:
 *   - aurora_state:  una sola fila (id=1) con el estado completo, el mismo
 *                    objeto que hoy vive en aurora.json.
 *   - aurora_assets: los bytes de los logos/branding por slot.
 *
 * aurora.json sigue siendo la fuente local y el fallback: TODAS las funciones
 * de este módulo capturan sus errores, los registran con console.warn y
 * devuelven null/false. Nada de aquí lanza, así que una base de datos caída
 * nunca puede tumbar el servidor ni bloquear un guardado local.
 */
export const persistEnabled = Boolean(config.databaseUrl)

let pool = null
let initPromise = null

const warn = (op, error) => console.warn(`[aurora] persist: ${op} falló (${error?.message || error}); sigo con aurora.json`)

/** Neon y Supabase exigen TLS; un Postgres local normalmente no lo tiene. */
const sslFor = raw => {
    try {
        const url = new URL(raw)
        const mode = url.searchParams.get('sslmode')
        if (mode === 'disable') return undefined
        // require / prefer / verify-ca / verify-full: se acepta el certificado
        // del pooler (Neon/Supabase terminan TLS con certificados propios).
        if (mode) return { rejectUnauthorized: false }
        if (/(neon\.tech|supabase\.co|supabase\.com)$/.test(url.hostname)) return { rejectUnauthorized: false }
        return undefined
    } catch {
        return { rejectUnauthorized: false }
    }
}

const getPool = () => {
    if (!pool) {
        pool = new pg.Pool({
            connectionString: config.databaseUrl,
            ssl: sslFor(config.databaseUrl),
            // El estado es un único JSON pequeño: no hace falta un pool grande,
            // y en planes gratuitos las conexiones son el recurso escaso.
            max: 2,
            connectionTimeoutMillis: 5000,
            queryTimeout: 15000,
            application_name: 'aurora-music',
        })
        // Sin este handler, un error de un cliente ocioso tumbaría el proceso.
        pool.on('error', error => warn('pool', error))
    }
    return pool
}

/** Crea las tablas si no existen. Devuelve true/false, nunca lanza. */
export const initPersist = () => {
    if (!persistEnabled) return Promise.resolve(false)
    if (!initPromise) {
        initPromise = (async () => {
            try {
                await getPool().query(`
                    CREATE TABLE IF NOT EXISTS aurora_state (
                        id int PRIMARY KEY,
                        data jsonb NOT NULL,
                        updated_at timestamptz NOT NULL DEFAULT now()
                    )`)
                await getPool().query(`
                    CREATE TABLE IF NOT EXISTS aurora_assets (
                        slot text PRIMARY KEY,
                        filename text NOT NULL,
                        mime text NOT NULL,
                        bytes bytea NOT NULL,
                        updated_at timestamptz NOT NULL DEFAULT now()
                    )`)
                console.log('[aurora] persist: Postgres activo (DATABASE_URL)')
                return true
            } catch (error) {
                warn('initPersist', error)
                // No memorizar el fallo: el próximo guardado lo reintenta.
                initPromise = null
                return false
            }
        })()
    }
    return initPromise
}

/** Estado completo guardado en Postgres, o null si no hay/nunca responde. */
export const loadState = async () => {
    if (!persistEnabled) return null
    try {
        if (!(await initPersist())) return null
        const { rows } = await getPool().query('SELECT data FROM aurora_state WHERE id = 1')
        return rows[0]?.data ?? null
    } catch (error) {
        warn('loadState', error)
        return null
    }
}

/** Upsert del estado completo. Devuelve true/false, nunca lanza. */
export const saveState = async data => {
    if (!persistEnabled) return false
    try {
        if (!(await initPersist())) return false
        await getPool().query(
            `INSERT INTO aurora_state (id, data, updated_at) VALUES (1, $1, now())
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [JSON.stringify(data)]
        )
        return true
    } catch (error) {
        warn('saveState', error)
        return false
    }
}

/** Bytes de un asset de branding: { filename, mime, buffer } o null. */
export const loadAsset = async slot => {
    if (!persistEnabled) return null
    try {
        if (!(await initPersist())) return null
        const { rows } = await getPool().query('SELECT filename, mime, bytes FROM aurora_assets WHERE slot = $1', [slot])
        if (!rows[0]) return null
        return { filename: rows[0].filename, mime: rows[0].mime, buffer: rows[0].bytes }
    } catch (error) {
        warn('loadAsset', error)
        return null
    }
}

/** Guarda/actualiza los bytes de un asset. Devuelve true/false, nunca lanza. */
export const saveAsset = async (slot, filename, mime, buffer) => {
    if (!persistEnabled) return false
    try {
        if (!(await initPersist())) return false
        await getPool().query(
            `INSERT INTO aurora_assets (slot, filename, mime, bytes, updated_at) VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (slot) DO UPDATE SET filename = EXCLUDED.filename, mime = EXCLUDED.mime,
                 bytes = EXCLUDED.bytes, updated_at = now()`,
            [slot, filename, mime, buffer]
        )
        return true
    } catch (error) {
        warn('saveAsset', error)
        return false
    }
}

/** Borra los bytes de un asset. Devuelve true/false, nunca lanza. */
export const deleteAsset = async slot => {
    if (!persistEnabled) return false
    try {
        if (!(await initPersist())) return false
        await getPool().query('DELETE FROM aurora_assets WHERE slot = $1', [slot])
        return true
    } catch (error) {
        warn('deleteAsset', error)
        return false
    }
}
