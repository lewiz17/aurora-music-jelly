import { useEffect, useState } from 'react'
import { buildAuthHeader, MediaItem } from '../api/jellyfin'
import { useAuroraConfig } from '../config/AuroraConfig'
import { useJellyfinContext } from '../context/JellyfinContext/JellyfinContext'
import { TracksIcon } from './SvgIcons'

/**
 * Artwork loader. Images are fetched with the Authorization header and shown as a
 * blob URL, so no token ever ends up in a URL (server logs, referrers, history).
 */
const cache = new Map<string, string>()

export const JellyImg = ({
    item,
    type,
    width,
    height,
    imageProps,
}: {
    item: MediaItem
    type: 'Primary' | 'Backdrop'
    width: number
    height: number
    imageProps?: React.DetailedHTMLProps<React.ImgHTMLAttributes<HTMLImageElement>, HTMLImageElement>
}) => {
    const api = useJellyfinContext()
    const config = useAuroraConfig()
    const [hasError, setError] = useState(false)
    const [src, setSrc] = useState<string | undefined>(() => {
        const url = item.downloadedImageUrl || api.getImageUrl(item, type, { width, height })
        return url ? cache.get(url) : undefined
    })

    const onlineImageUrl = item.downloadedImageUrl || api.getImageUrl(item, type, { width, height })
    const fallbackImage = type === 'Primary' ? config.assets.albumPlaceholder : null

    useEffect(() => {
        setError(false)
        if (!onlineImageUrl) {
            setSrc(undefined)
            return
        }

        const cached = cache.get(onlineImageUrl)
        if (cached) {
            setSrc(cached)
            return
        }

        // Offline downloads keep their own blob/data url; only remote images need the header
        if (onlineImageUrl.startsWith('blob:') || onlineImageUrl.startsWith('data:')) {
            setSrc(onlineImageUrl)
            return
        }

        let cancelled = false
        const controller = new AbortController()

        fetch(onlineImageUrl, {
            headers: { Authorization: buildAuthHeader(api.auth.token) },
            signal: controller.signal,
        })
            .then(response => (response.ok ? response.blob() : Promise.reject(new Error('image'))))
            .then(blob => {
                if (cancelled) return
                const objectUrl = URL.createObjectURL(blob)
                cache.set(onlineImageUrl, objectUrl)
                setSrc(objectUrl)
            })
            .catch(() => {
                if (!cancelled) setError(true)
            })

        return () => {
            cancelled = true
            controller.abort()
        }
    }, [onlineImageUrl, api.auth.token])

    const finalSrc = src || (hasError ? fallbackImage || undefined : undefined)

    return (
        <>
            {!hasError && finalSrc && (
                <img
                    {...imageProps}
                    src={finalSrc}
                    alt={item.Name}
                    className="thumbnail"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setError(true)}
                />
            )}

            {(hasError || !finalSrc) && (
                <div className="fallback-thumbnail">
                    <TracksIcon width="50%" height="50%" />
                </div>
            )}
        </>
    )
}
