import { MediaList } from '../components/MediaList'
import { useJellyfinAlbumArtistsData } from '../hooks/Jellyfin/Infinite/useJellyfinAlbumArtistsData'
import { useI18n } from '../i18n/i18n'

export const AlbumArtists = () => {
    const { t } = useI18n()
    const { items, infiniteData, isLoading, error, reviver, loadMore } = useJellyfinAlbumArtistsData()

    return (
        <div className="artists-page">
            <MediaList
                items={items}
                infiniteData={infiniteData}
                isLoading={isLoading}
                type="artist"
                title={t('list.albumArtists')}
                reviver={reviver}
                loadMore={loadMore}
                hidden={{ view_artist: true }}
            />
            {error && <div className="error">{error}</div>}
        </div>
    )
}
