/**
 * Failed-attempt limiter (in memory, per key). Used on the logins, which are the only unauthenticated
 * endpoints that check secrets: the admin panel, and the gateway login, which forwards credentials to
 * Jellyfin and would otherwise let anyone brute-force a user's password through us.
 *
 * Only FAILURES count, so a family sharing one home IP is not locked out by successful logins.
 * A key that reaches `max` failures is blocked until its window expires; success clears it.
 */
export const createLimiter = ({ windowMs, max }) => {
    const entries = new Map()

    const live = key => {
        const entry = entries.get(key)
        if (entry && entry.reset > Date.now()) return entry
        entries.delete(key)
        return null
    }

    // Drop expired keys so a scan from many IPs cannot grow the map forever.
    setInterval(() => {
        const now = Date.now()
        for (const [key, entry] of entries) if (entry.reset <= now) entries.delete(key)
    }, Math.max(1000, Math.min(windowMs, 60_000))).unref()

    return {
        blocked: key => (live(key)?.count ?? 0) >= max,
        retryAfterSeconds: key => Math.max(1, Math.ceil(((live(key)?.reset ?? Date.now()) - Date.now()) / 1000)),
        fail: key => {
            const entry = live(key) || { count: 0, reset: Date.now() + windowMs }
            entry.count++
            entries.set(key, entry)
        },
        clear: key => entries.delete(key),
    }
}

/** Express guard: answers 429 (with Retry-After) while the caller's IP is blocked. */
export const blockedGuard = (limiter, message) => (req, res, next) => {
    if (!limiter.blocked(req.ip)) return next()
    res.setHeader('Retry-After', String(limiter.retryAfterSeconds(req.ip)))
    res.status(429).json({ error: 'too_many_attempts', message })
}
