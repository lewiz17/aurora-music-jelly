/** Server-side Jellyfin helpers for the admin panel (uses a per-server API key). */

const CLIENT = 'MediaBrowser Client="Aurora Admin", Device="Server", DeviceId="aurora-admin", Version="1.0.0"'

const call = async (serverUrl, apiKey, path, options = {}) => {
    const url = `${serverUrl}${path}`
    const headers = { Authorization: `${CLIENT}, Token="${apiKey}"`, ...(options.headers || {}) }
    const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(25000) })
    if (!response.ok) {
        const error = new Error(`Jellyfin ${response.status}`)
        error.status = response.status
        throw error
    }
    if (response.status === 204) return null
    const text = await response.text()
    return text ? JSON.parse(text) : null
}

export const publicInfo = async serverUrl => {
    const data = await call(serverUrl, '', '/System/Info/Public')
    return { name: data.ServerName, version: data.Version }
}

export const pickUserId = async (serverUrl, apiKey) => {
    const users = await call(serverUrl, apiKey, '/Users')
    if (!Array.isArray(users) || !users.length) throw new Error('La clave API no puede listar usuarios')
    const admin = users.find(u => u.Policy?.IsAdministrator) || users[0]
    return admin.Id
}

export const searchTracks = async (serverUrl, apiKey, userId, term, limit = 6) => {
    const params = new URLSearchParams({
        userId,
        searchTerm: term,
        includeItemTypes: 'Audio',
        recursive: 'true',
        limit: String(limit),
        fields: 'RunTimeTicks,Artists,AlbumArtist,Album,AlbumId,ProductionYear',
    })
    const data = await call(serverUrl, apiKey, `/Items?${params.toString()}`)
    return data?.Items || []
}

export const createPlaylist = async (serverUrl, apiKey, name) => {
    const data = await call(serverUrl, apiKey, '/Playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Name: name, IsPublic: false, MediaType: 'Audio' }),
    })
    return data?.Id
}

export const addToPlaylist = async (serverUrl, apiKey, playlistId, itemIds) => {
    const chunk = 200
    for (let i = 0; i < itemIds.length; i += chunk) {
        const ids = itemIds.slice(i, i + chunk).join(',')
        await call(serverUrl, apiKey, `/Playlists/${playlistId}/Items?ids=${encodeURIComponent(ids)}`, {
            method: 'POST',
        })
    }
}

export const listPlaylists = async (serverUrl, apiKey, userId) => {
    const params = new URLSearchParams({ userId, includeItemTypes: 'Playlist', recursive: 'true' })
    const data = await call(serverUrl, apiKey, `/Items?${params.toString()}`)
    return data?.Items || []
}


/**
 * Admin authentication. We keep the user's access token in memory (never on disk)
 * so playlist creation works even without an API key configured.
 */
const tokenCache = new Map()

export const authenticateAdmin = async (serverUrl, username, password) => {
    const response = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { Authorization: CLIENT, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: username, Pw: password }),
        signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) {
        const error = new Error(response.status === 401 ? 'Usuario o contraseña incorrectos' : `Jellyfin ${response.status}`)
        error.status = response.status
        throw error
    }
    const data = await response.json()
    const session = { token: data.AccessToken, userId: data.User.Id, username: data.User.Name, at: Date.now() }
    tokenCache.set(serverUrl, session)
    return session
}

export const getAdminSession = serverUrl => {
    const session = tokenCache.get(serverUrl)
    if (!session) return null
    // Tokens are valid for a long time; refresh the entry after 20 days
    if (Date.now() - session.at > 20 * 24 * 60 * 60 * 1000) {
        tokenCache.delete(serverUrl)
        return null
    }
    return session
}

export const clearAdminSession = serverUrl => tokenCache.delete(serverUrl)

/** Resolves credentials for library work: API key first, in-memory admin token second. */
export const resolveCredentials = async server => {
    const session = getAdminSession(server.jellyfinUrl)

    if (server.apiKey) {
        try {
            const userId = await pickUserId(server.jellyfinUrl, server.apiKey)
            return { token: server.apiKey, userId }
        } catch (error) {
            // A stale key should not block the importer if the account is connected
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
