import { getStore } from './store.js'

/** Failed logins allowed per client and window before answering 429 (same variables as the Node server). */
export const limitsOf = env => ({
    max: Number(env.LOGIN_MAX_FAILURES || 10),
    windowMs: Number(env.LOGIN_WINDOW_MS || 15 * 60 * 1000),
})

/** Real client address: Cloudflare sets cf-connecting-ip and clients cannot forge it. */
export const clientIp = c =>
    c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

export const secretOf = env => env.SESSION_SECRET || ''

export const tooManyAttempts = (c, retryAfter) => {
    c.header('Retry-After', String(retryAfter))
    return c.json(
        { error: 'too_many_attempts', message: 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.' },
        429
    )
}

/** Returns a 429 Response when `key` is blocked, otherwise null. */
export const blockedResponse = async (c, store, key) => {
    const { blocked, retryAfter } = await store.attempts.check(key, limitsOf(c.env).max)
    return blocked ? tooManyAttempts(c, retryAfter) : null
}

export { getStore }
