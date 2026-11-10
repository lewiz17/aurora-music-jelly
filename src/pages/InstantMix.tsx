import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { JellyImg } from '../components/JellyImg'
import { Loader } from '../components/Loader'
import { PlaylistTrackList } from '../components/PlaylistTrackList'
import { Squircle } from '../components/Squircle'
import { useI18n } from '../i18n/i18n'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { usePlaybackContext } from '../context/PlaybackContext/PlaybackContext'
import { useJellyfinInstantMixData } from '../hooks/Jellyfin/useJellyfinInstantMixData'
import { useJellyfinMediaItem } from '../hooks/Jellyfin/useJellyfinMediaItem'
import { formatDurationReadable } from '../utils/formatDurationReadable'
import './InstantMix.css'

export const InstantMix = () => {
    const { t } = useI18n()
    const { songId } = useParams<{ songId: string }>()
    const { items, loading, error } = useJellyfinInstantMixData({ songId })
    const { mediaItem: sourceSong } = useJellyfinMediaItem(songId)
    const playback = usePlaybackContext()
    const { setPageTitle } = usePageTitle()

    useEffect(() => {
        if (sourceSong) {
            setPageTitle(`${t('list.instantMix')} - ${sourceSong.Name}`)
        }
        return () => {
            setPageTitle('')
        }
    }, [sourceSong, setPageTitle])

    if (loading && items.length === 0) {
        return <Loader />
    }

    if (error) {
        return <div className="error">{error}</div>
    }

    const totalPlaytime = items.reduce((total, item) => total + (item.RunTimeTicks || 0), 0)

    return (
        <div className="instant-mix-page">
            <div className="instant-mix-header">
                {sourceSong && (
                    <Squircle width={100} height={100} cornerRadius={8} className="thumbnail">
                        <JellyImg item={sourceSong} type={'Primary'} width={100} height={100} />
                    </Squircle>
                )}

                <div className="instant-mix-details">
                    <div className="title">{t('list.instantMix')}</div>
                    <div className="subtitle">
                        {t('list.basedOn')} <span className="highlight">{sourceSong?.Name || t('misc.unknownSong')}</span>
                    </div>
                    <div className="stats">
                        <div className="track-amount">
                            <span className="number">{items.length}</span>{' '}
                            <span>{items.length === 1 ? t('list.tracks.one') : t('list.tracks.many')}</span>
                        </div>
                        <div className="divider"></div>
                        <div className="length">
                            <span className="number">{formatDurationReadable(totalPlaytime)}</span> <span>{t('common.total')}</span>
                        </div>
                    </div>
                    <div className="actions noSelect">
                        <div className="primary">
                            <div
                                className="play-instant-mix"
                                onClick={() => {
                                    if (playback.setCurrentPlaylistSimple({ playlist: items, title: t('list.instantMix') })) {
                                        playback.playTrack(0)
                                    }
                                }}
                            >
                                <div className="play-icon" />
                                <div className="text">{t('common.play')}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <PlaylistTrackList
                tracks={items}
                infiniteData={{ pageParams: [1], pages: [items] }}
                isLoading={loading}
                title={sourceSong ? `Instant Mix - ${sourceSong.Name}` : 'Instant Mix'}
                disableUrl={true}
            />
        </div>
    )
}
