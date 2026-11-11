/**
 * Tokens and secrets with WebCrypto (available in Workers, Node 20+ and browsers).
 *
 * The formats are byte-compatible with server/src/session.js, so a gateway or admin token minted by
 * the Node server is valid here (and the other way round) as long as SESSION_SECRET is the same:
 *   gateway token = base64url( iv(12) | authTag(16) | ciphertext )   AES-256-GCM
 *   admin token   = base64url(payload JSON) + "." + base64url( HMAC-SHA256(payload) )
 * The key is SHA-256(SESSION_SECRET), as in the Node version.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const FALLBACK_SECRET = 'aurora-dev-secret-change-me'

export const toBase64Url = bytes => {
    let binary = ''
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export const fromBase64Url = text => {
    const normalized = String(text).replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

const keyCache = new Map()

/** AES + HMAC keys derived from the secret (cached per isolate). `label` separates uses of the secret. */
const keysFor = async (secret, label = '') => {
    const material = `${secret || FALLBACK_SECRET}${label}`
    let cached = keyCache.get(material)
    if (!cached) {
        cached = (async () => {
            const raw = await crypto.subtle.digest('SHA-256', encoder.encode(material))
            const [aes, hmac] = await Promise.all([
                crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
                crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
            ])
            return { aes, hmac }
        })()
        keyCache.set(material, cached)
    }
    return cached
}

const seal = async (secret, label, text) => {
    const { aes } = await keysFor(secret, label)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    // WebCrypto returns ciphertext || tag; the Node layout is iv | tag | ciphertext
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(text)))
    const ciphertext = sealed.subarray(0, sealed.length - 16)
    const tag = sealed.subarray(sealed.length - 16)
    const out = new Uint8Array(12 + 16 + ciphertext.length)
    out.set(iv, 0)
    out.set(tag, 12)
    out.set(ciphertext, 28)
    return toBase64Url(out)
}

const open = async (secret, label, token) => {
    try {
        const raw = fromBase64Url(token)
        if (raw.length < 29) return null
        const { aes } = await keysFor(secret, label)
        const iv = raw.subarray(0, 12)
        const tag = raw.subarray(12, 28)
        const ciphertext = raw.subarray(28)
        const joined = new Uint8Array(ciphertext.length + 16)
        joined.set(ciphertext, 0)
        joined.set(tag, ciphertext.length)
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aes, joined)
        return decoder.decode(plain)
    } catch {
        return null
    }
}

// ---------- gateway session tokens (same format as server/src/session.js) ----------

export const createSessionToken = (secret, payload) => seal(secret, '', JSON.stringify({ ...payload, iat: Date.now() }))

export const readSessionToken = async (secret, token) => {
    const text = await open(secret, '', token)
    if (!text) return null
    try {
        const parsed = JSON.parse(text)
        if (!parsed || !parsed.serverId || !parsed.upstreamToken) return null
        return parsed
    } catch {
        return null
    }
}

// ---------- admin tokens ----------

const sign = async (secret, value) => {
    const { hmac } = await keysFor(secret)
    return toBase64Url(await crypto.subtle.sign('HMAC', hmac, encoder.encode(value)))
}

export const makeAdminToken = async secret => {
    const payload = toBase64Url(
        encoder.encode(JSON.stringify({ role: 'admin', exp: Date.now() + 1000 * 60 * 60 * 12 }))
    )
    return `${payload}.${await sign(secret, payload)}`
}

export const verifyAdminToken = async (secret, signed) => {
    try {
        const text = String(signed || '')
        const idx = text.lastIndexOf('.')
        if (idx < 1) return null
        const value = text.slice(0, idx)
        const mac = fromBase64Url(text.slice(idx + 1))
        const { hmac } = await keysFor(secret)
        // subtle.verify compares in constant time
        const ok = await crypto.subtle.verify('HMAC', hmac, mac, encoder.encode(value))
        if (!ok) return null
        const parsed = JSON.parse(decoder.decode(fromBase64Url(value)))
        if (parsed.exp && Date.now() > parsed.exp) return null
        return parsed
    } catch {
        return null
    }
}

// ---------- small helpers ----------

/** Constant-time string comparison (both sides are hashed first so lengths do not leak). */
export const safeEqual = async (a, b) => {
    const [da, db] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(String(a))),
        crypto.subtle.digest('SHA-256', encoder.encode(String(b))),
    ])
    const x = new Uint8Array(da)
    const y = new Uint8Array(db)
    let diff = 0
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
    return diff === 0
}

/** Encrypts a JSON value for storage (e.g. the Jellyfin admin session kept in the database). */
export const sealJson = (secret, value) => seal(secret, ':stored', JSON.stringify(value))

export const openJson = async (secret, token) => {
    const text = await open(secret, ':stored', token)
    if (!text) return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}
