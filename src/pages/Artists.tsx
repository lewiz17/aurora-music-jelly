import { Link } from 'react-router-dom'
import { MediaList } from '../components/MediaList'
import { useJellyfinArtistsData } from '../hooks/Jellyfin/Infinite/useJellyfinArtistsData'
import { useI18n } from '../i18n/i18n'

export const Artists = () => {
    const { t } = useI18n()
    const { items, infiniteData, isLoading, error, reviver, loadMore } = useJellyfinArtistsData()

    return (
        <div className="artists-page">
            <div className="album-artists">
                <Link to="/albumartists" className="textlink">
                    {t('list.viewAlbumArtists')}
                </Link>
            </div>
            <MediaList
                items={items}
                infiniteData={infiniteData}
                isLoading={isLoading}
                type="artist"
                title={t('list.artists')}
                reviver={reviver}
                loadMore={loadMore}
                hidden={{ view_artist: true }}
            />
            {error && <div className="error">{error}</div>}
        </div>
    )
}
