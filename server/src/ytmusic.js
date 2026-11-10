/**
 * Minimal YouTube Music (InnerTube) reader: no API key of your own, no OAuth.
 * Works with public playlists, album links and single song links.
 */

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const CLIENT_VERSION = '1.20240101.01.00'
const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const context = () => ({
    client: { clientName: 'WEB_REMIX', clientVersion: CLIENT_VERSION, hl: 'en', gl: 'US' },
})

const post = async (endpoint, body) => {
    const response = await fetch(`https://music.youtube.com/youtubei/v1/${endpoint}?key=${INNERTUBE_KEY}&prettyPrint=false`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': UA,
            Origin: 'https://music.youtube.com',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        body: JSON.stringify({ context: context(), ...body }),
        signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) throw new Error(`YouTube Music respondió ${response.status}`)
    return response.json()
}

const walk = (node, matcher, out = []) => {
    if (!node || typeof node !== 'object') return out
    if (Array.isArray(node)) {
        for (const child of node) walk(child, matcher, out)
        return out
    }
    for (const [key, value] of Object.entries(node)) {
        if (matcher(key, value)) out.push({ key, value })
        walk(value, matcher, out)
    }
    return out
}

const textOf = runs => (runs || []).map(r => r.text || '').join('').trim()

/** Accepts a full YT Music URL, a plain playlist id, or a "list=" query string. */
export const parseYtInput = input => {
    const raw = String(input || '').trim()
    if (!raw) return null

    const listMatch = raw.match(/[?&]list=([A-Za-z0-9_-]+)/)
    if (listMatch) return { type: 'playlist', id: listMatch[1] }

    const videoMatch = raw.match(/[?&]v=([A-Za-z0-9_-]{11})/)
    if (videoMatch) return { type: 'song', id: videoMatch[1] }

    if (/^(VL|PL|OLAK5uy_|RD|UU|LL|FL)[A-Za-z0-9_-]+$/.test(raw)) {
        if (raw.startsWith('OLAK5uy_') || raw.startsWith('MPREb_')) return { type: 'album', id: raw }
        if (raw.startsWith('VL')) return { type: 'playlist', id: raw.slice(2) }
        return { type: 'playlist', id: raw }
    }

    const browseMatch = raw.match(/browse\/([A-Za-z0-9_-]+)/)
    if (browseMatch) return { type: 'album', id: browseMatch[1] }

    return null
}

const extractTracks = data => {
    const items = []
    walk(data, (key, value) => {
        if (key === 'musicResponsiveListItemRenderer') items.push(value)
        return false
    })
    // walk() pushes via matcher, so flatten
    const flat = []
    const collect = node => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) return node.forEach(collect)
        if (node.musicResponsiveListItemRenderer) flat.push(node.musicResponsiveListItemRenderer)
        for (const value of Object.values(node)) collect(value)
    }
    collect(data)

    return flat
        .map(renderer => {
            const columns = (renderer.flexColumns || []).map(
                column => textOf(column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs) || ''
            )
            const videoId = renderer.playlistItemData?.videoId || findVideoId(renderer) || ''
            const duration =
                textOf(renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs) || ''
            if (!columns[0]) return null
            return {
                title: columns[0],
                artist: columns[1] || '',
                album: columns[2] || '',
                duration,
                videoId,
            }
        })
        .filter(Boolean)
}

const findVideoId = renderer => {
    const found = walk(renderer, (key, value) => key === 'watchEndpoint' && value?.videoId)
    return found.find(f => f.value?.videoId)?.value.videoId
}

const findContinuation = data => {
    const found = walk(data, (key, value) => key === 'continuationCommand' && value?.token)
    return found.find(f => f.value?.token)?.value.token || null
}

const findPlaylistTitle = data => {
    const found = walk(
        data,
        (key, value) =>
            (key === 'musicDetailHeaderRenderer' || key === 'musicEditablePlaylistDetailHeaderRenderer') && value
    )
    for (const entry of found) {
        const header = entry.value
        const title =
            textOf(header.title?.runs) ||
            textOf(header.header?.musicDetailHeaderRenderer?.title?.runs) ||
            textOf(header.header?.musicDetailHeaderRenderer?.title?.runs)
        if (title) return title
    }
    const micro = walk(data, (key, value) => key === 'microformat' && value)
    for (const entry of micro) {
        const t =
            entry.value?.microformatDataRenderer?.title ||
            entry.value?.microformatDataRenderer?.unlisted
        if (typeof t === 'string') return t
    }
    return ''
}

/**
 * Reads a playlist (following continuations) and returns its tracks in order.
 * `limit` protects against a family hitting a 5000-track playlist by accident.
 */
export const fetchPlaylist = async (input, { limit = 500 } = {}) => {
    const parsed = parseYtInput(input)
    if (!parsed) throw new Error('Enlace de YouTube Music no reconocido.')

    if (parsed.type === 'song') {
        const data = await post('player', { videoId: parsed.id })
        const details = data?.videoDetails || {}
        return {
            title: details.title || 'Canción',
            sourceUrl: `https://music.youtube.com/watch?v=${parsed.id}`,
            tracks: [
                {
                    title: details.title || '',
                    artist: details.author || '',
                    album: details.title || '',
                    duration: '',
                    videoId: parsed.id,
                },
            ],
        }
    }

    const browseId = parsed.type === 'album' ? parsed.id : `VL${parsed.id}`
    let data = await post('browse', { browseId })
    const title = findPlaylistTitle(data) || 'Lista de YouTube Music'

    let tracks = extractTracks(data)
    let token = findContinuation(data)
    let guard = 0

    while (token && tracks.length < limit && guard < 30) {
        guard++
        const page = await post('browse', { continuation: token })
        tracks = tracks.concat(extractTracks(page))
        token = findContinuation(page)
    }

    return {
        title,
        sourceUrl: parsed.type === 'album' ? `https://music.youtube.com/browse/${parsed.id}` : `https://music.youtube.com/playlist?list=${parsed.id}`,
        tracks: tracks.slice(0, limit),
    }
}
