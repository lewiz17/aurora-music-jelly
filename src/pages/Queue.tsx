import { useEffect } from 'react'
import { useI18n } from '../i18n/i18n'
import { Link } from 'react-router-dom'
import { MediaList } from '../components/MediaList'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { usePlaybackContext } from '../context/PlaybackContext/PlaybackContext'
import './Queue.css'

export const Queue = () => {
    const { t } = useI18n()
    const { setPageTitle } = usePageTitle()
    const { currentTrack, currentPlaylist, currentTrackIndex, isLoading, loadMore } = usePlaybackContext()

    useEffect(() => {
        setPageTitle(t('list.queue'))
        return () => setPageTitle('')
    }, [setPageTitle])

    if (!currentTrack) {
        return <div className="empty-queue">{t('list.empty.queue')}</div>
    }

    const queueTracks = currentPlaylist.slice(currentTrackIndex + 1)

    return (
        <div className="queue-page">
            <div className="queue-header">
                <MediaList
                    items={[currentTrack]}
                    infiniteData={{ pageParams: [1], pages: [[currentTrack]] }}
                    isLoading={false}
                    type="song"
                    title={t('list.currentTrack')}
                    hidden={{ add_to_queue: true, remove_from_queue: true }}
                />
                <div className="queue-desc">
                    <span className="text">
                        {t('list.from')}{' '}
                        {currentTrack?.originUrl ? (
                            <Link to={currentTrack.originUrl} className="textlink">
                                {currentTrack.originTitle}
                            </Link>
                        ) : (
                            <span className="highlight">{currentTrack?.originTitle}</span>
                        )}
                    </span>
                </div>
            </div>

            {(queueTracks.length > 0 || isLoading) && (
                <>
                    <div className="queue-title">{t('list.nextInQueue')}</div>
                    <MediaList
                        items={queueTracks}
                        infiniteData={{ pageParams: [1], pages: [queueTracks] }}
                        indexOffset={currentTrackIndex + 1}
                        isLoading={isLoading}
                        type="song"
                        loadMore={loadMore}
                        title={t('list.nextUp')}
                        hidden={{ add_to_queue: true }}
                        reviver={'persistAll'}
                        isDraggable={true}
                    />
                </>
            )}
        </div>
    )
}
