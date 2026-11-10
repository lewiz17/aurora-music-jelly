import { MediaList } from '../components/MediaList'
import { useJellyfinFrequentlyPlayedData } from '../hooks/Jellyfin/Infinite/useJellyfinFrequentlyPlayedData'
import { useI18n } from '../i18n/i18n'

export const FrequentlyPlayed = () => {
    const { t } = useI18n()
    const { items, infiniteData, isLoading, error, reviver, loadMore } = useJellyfinFrequentlyPlayedData()

    return (
        <div className="frequently-page">
            {error && <div className="error">{error}</div>}
            <MediaList
                items={items}
                infiniteData={infiniteData}
                isLoading={isLoading}
                type="song"
                title={t('list.frequently')}
                reviver={reviver}
                loadMore={loadMore}
            />
        </div>
    )
}
