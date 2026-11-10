import { MediaList } from '../components/MediaList'
import { useJellyfinRecentlyPlayedData } from '../hooks/Jellyfin/Infinite/useJellyfinRecentlyPlayedData'
import { useI18n } from '../i18n/i18n'

export const RecentlyPlayed = () => {
    const { t } = useI18n()
    const { items, infiniteData, isLoading, error, reviver, loadMore } = useJellyfinRecentlyPlayedData()

    return (
        <div className="recently-page">
            {error && <div className="error">{error}</div>}
            <MediaList
                items={items}
                infiniteData={infiniteData}
                isLoading={isLoading}
                type="song"
                title={t('list.recently')}
                reviver={reviver}
                loadMore={loadMore}
            />
        </div>
    )
}
