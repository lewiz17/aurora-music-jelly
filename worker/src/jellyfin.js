/**
 * Jellyfin admin helpers. The HTTP calls are the same module the Node server uses
 * (server/src/jellyfin-admin.js); only the session handling differs: a Worker has no memory that
 * survives between requests, so the connected admin account is kept encrypted in the database.
 */
import { authenticateAdmin, pickUserId } from '../../server/src/jellyfin-admin.js'
import { openJson, sealJson } from './crypto.js'
import { secretOf } from './context.js'

export { addToPlaylist, createPlaylist, pickUserId, publicInfo, searchTracks } from '../../server/src/jellyfin-admin.js'

const SESSION_MAX_AGE_MS = 20 * 24 * 60 * 60 * 1000

export const connectAdminAccount = async (env, store, server, username, password) => {
    const session = await authenticateAdmin(server.jellyfinUrl, username, password || '')
    await store.setJfSession(
        server.jellyfinUrl,
        await sealJson(secretOf(env), {
            token: session.token,
            userId: session.userId,
            username: session.username,
            at: Date.now(),
        })
    )
    return session
}

export const adminSession = async (env, store, server) => {
    const sealed = await store.getJfSession(server.jellyfinUrl)
    if (!sealed) return null
    const session = await openJson(secretOf(env), sealed)
    if (!session || Date.now() - session.at > SESSION_MAX_AGE_MS) return null
    return session
}

/** API key first, the connected admin account second (same rule as the Node server). */
export const resolveCredentials = async (env, store, server) => {
    const session = await adminSession(env, store, server)

    if (server.apiKey) {
        try {
            const userId = await pickUserId(server.jellyfinUrl, server.apiKey)
            return { token: server.apiKey, userId }
        } catch {
            if (!session) {
                throw Object.assign(
                    new Error('La clave API no es válida. Revísala o conecta tu cuenta en la pestaña de listas.'),
                    { status: 400 }
                )
            }
        }
    }

    if (session) return { token: session.token, userId: session.userId }

    throw Object.assign(
        new Error('Necesitas conectar tu cuenta (pestaña "Listas") o añadir una clave API válida.'),
        { status: 400 }
    )
}
