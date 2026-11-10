import { MediaItem } from '../api/jellyfin'
import { useJellyfinTrackInfo } from '../hooks/Jellyfin/useJellyfinTrackInfo'
import { useI18n } from '../i18n/i18n'

export const useTrackBitrate = (currentTrack: MediaItem | undefined) => {
    const mediaSourceBitRate = currentTrack?.MediaSources?.[0].Bitrate
    const trackInfo = useJellyfinTrackInfo(typeof mediaSourceBitRate === 'number' ? '' : currentTrack?.Id || '')
    return Math.round((mediaSourceBitRate || trackInfo.MediaSources?.[0].Bitrate || 0) / 1000)
}

export const TrackBitrate = ({ currentTrack }: { currentTrack: MediaItem | undefined }) => {
    return <>{useTrackBitrate(currentTrack)}</>
}

/** "Original" when streaming the source file, otherwise the audio bitrate. */
export const TrackQuality = ({ currentTrack }: { currentTrack: MediaItem | undefined }) => {
    const { t } = useI18n()
    const bitrate = useTrackBitrate(currentTrack)
    return <>{bitrate ? `${bitrate} kbps` : t('player.source')}</>
}

/** Localised tier label ("Alta", "Media", "Baja", "Mínima") for the same bitrate. */
export const TrackQualityLabel = ({ currentTrack }: { currentTrack: MediaItem | undefined }) => {
    const { t } = useI18n()
    const bitrate = useTrackBitrate(currentTrack)

    if (!bitrate) return <>{t('player.source')}</>
    if (bitrate >= 300) return <>{t('now.qualityHigh')}</>
    if (bitrate >= 240) return <>{t('now.qualityMedium')}</>
    if (bitrate >= 160) return <>{t('now.qualityLow')}</>
    return <>{t('now.qualityMinimal')}</>
}
