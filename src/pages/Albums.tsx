import { MediaList } from '../components/MediaList'
import { useJellyfinAlbumsData } from '../hooks/Jellyfin/Infinite/useJellyfinAlbumsData'
import { useI18n } from '../i18n/i18n'

export const Albums = () => {
    const { t } = useI18n()
    const { items, infiniteData, isLoading, error, reviver, loadMore } = useJellyfinAlbumsData()

    return (
        <div className="albums-page">
            <MediaList
                items={items}
                infiniteData={infiniteData}
                isLoading={isLoading}
                type="album"
                title={t('list.albums')}
                reviver={reviver}
                loadMore={loadMore}
                hidden={{ view_album: true }}
            />
            {error && <div className="error">{error}</div>}
        </div>
    )
}
