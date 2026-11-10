/** Text normalisation + similarity used to pair YouTube Music tracks with the library. */

const NOISE = [
    /\s*[([][^)\]]*(official|video|audio|lyric|lyrics|visualizer|hd|hq|4k|remaster(ed)?|explicit|clean|clip oficial|en vivo|live session)[^)\]]*[)\]]/gi,
    /\s*[-–]\s*(topic|official audio|official video|lyric video|audio|video)\s*$/gi,
    /\s*(feat\.?|ft\.?|featuring)\s+[^,)\]]+$/gi,
    // YouTube Music truncates long titles with "..."
    /\s*\.{2,}\s*$/g,
    /\s*\.{3}[^.]*$/g,
    // ...and leaves unbalanced parentheses when it cuts
    /\s*[([][^)\]]*$/g,
    /\s*\*+\s*/g,
]

export const normalize = value => {
    let out = String(value || '')
    for (const pattern of NOISE) out = out.replace(pattern, ' ')
    return out
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip accents
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const bigrams = text => {
    const clean = text.replace(/\s/g, '')
    const out = new Set()
    for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2))
    return out
}

/** Sørensen–Dice coefficient, 0..1 */
export const similarity = (a, b) => {
    const left = normalize(a)
    const right = normalize(b)
    if (!left || !right) return 0
    if (left === right) return 1
    const A = bigrams(left)
    const B = bigrams(right)
    if (!A.size || !B.size) return 0
    let overlap = 0
    for (const gram of A) if (B.has(gram)) overlap++
    return (2 * overlap) / (A.size + B.size)
}

const artistNames = (...values) =>
    values
        .flat()
        .filter(Boolean)
        .map(v => normalize(v))
        .filter(Boolean)

/** Score a library candidate against a YouTube Music track. */
export const scoreCandidate = (ytTrack, candidate) => {
    const titleScore = similarity(ytTrack.title, candidate.Name)
    const ytArtists = artistNames(ytTrack.artist)
    const candidateArtists = artistNames(
        candidate.Artists,
        candidate.AlbumArtist ? [candidate.AlbumArtist] : [],
        candidate.AlbumArtists?.map(a => a.Name)
    )
    let artistScore = 0
    for (const a of candidateArtists) {
        for (const b of ytArtists) {
            const direct = similarity(a, b)
            // "Peso Pluma & Anitta" vs "Peso Pluma": partial credit
            const contains = a.includes(b) || b.includes(a) ? 0.85 : 0
            artistScore = Math.max(artistScore, direct, contains)
        }
    }
    if (!ytArtists.length) artistScore = 0.5

    // Duration is a strong tie-breaker when present
    let durationScore = 0
    if (ytTrack.duration && candidate.RunTimeTicks) {
        const [m, s] = ytTrack.duration.split(':').map(Number)
        const ytSeconds = m * 60 + (s || 0)
        const libSeconds = candidate.RunTimeTicks / 10_000_000
        const diff = Math.abs(ytSeconds - libSeconds)
        durationScore = diff <= 3 ? 1 : diff <= 10 ? 0.7 : diff <= 25 ? 0.3 : 0
    }

    let score = titleScore * 0.62 + artistScore * 0.28 + durationScore * 0.1

    // A different artist is a strong signal (covers, karaoke, tributes):
    // never auto-accept it, even if the title matches perfectly.
    if (ytArtists.length && candidateArtists.length && artistScore < 0.4) score = Math.min(score, 0.5)

    return Math.round(score * 100) / 100
}

export const classify = score => (score >= 0.72 ? 'auto' : score >= 0.45 ? 'review' : 'none')

/** Runs `worker` over `items` with bounded concurrency. */
export const mapLimit = async (items, limit, worker) => {
    const results = new Array(items.length)
    let cursor = 0
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            results[index] = await worker(items[index], index)
        }
    })
    await Promise.all(runners)
    return results
}
