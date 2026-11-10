import crypto from 'node:crypto'
import { config } from './config.js'

const key = crypto.createHash('sha256').update(config.secret || 'aurora-dev-secret-change-me').digest()

/**
 * Gateway sessions are opaque to the browser: AES-256-GCM encrypted payload holding
 * the upstream Jellyfin token, the target server and the user id.
 * Stateless, so a free-tier container can sleep/restart without kicking everyone out.
 */
export const createSessionToken = payload => {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() }))
    const enc = Buffer.concat([cipher.update(data), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url')
}

export const readSessionToken = token => {
    try {
        const raw = Buffer.from(String(token), 'base64url')
        if (raw.length < 29) return null
        const iv = raw.subarray(0, 12)
        const tag = raw.subarray(12, 28)
        const enc = raw.subarray(28)
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
        decipher.setAuthTag(tag)
        const data = Buffer.concat([decipher.update(enc), decipher.final()])
        const parsed = JSON.parse(data.toString())
        if (!parsed || !parsed.serverId || !parsed.upstreamToken) return null
        return parsed
    } catch {
        return null
    }
}

export const signAdmin = value => {
    const mac = crypto.createHmac('sha256', key).update(value).digest('base64url')
    return `${value}.${mac}`
}

export const verifyAdminSignature = signed => {
    try {
        const idx = String(signed).lastIndexOf('.')
        if (idx < 1) return null
        const value = signed.slice(0, idx)
        const mac = signed.slice(idx + 1)
        const expected = crypto.createHmac('sha256', key).update(value).digest('base64url')
        if (mac.length !== expected.length) return null
        if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString())
        if (parsed.exp && Date.now() > parsed.exp) return null
        return parsed
    } catch {
        return null
    }
}

export const makeAdminToken = () => {
    const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + 1000 * 60 * 60 * 12 })).toString(
        'base64url'
    )
    return signAdmin(payload)
}

/** Kept for backwards compatibility with the cookie flow */
export const makeAdminCookie = makeAdminToken
