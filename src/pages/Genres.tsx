import { MediaList } from '../components/MediaList'
import { useJellyfinGenresData } from '../hooks/Jellyfin/Infinite/useJellyfinGenresData'
import { useI18n } from '../i18n/i18n'

export const Genres = () => {
    const { t } = useI18n()
    const { items, infiniteData, isLoading, error, reviver, loadMore } = useJellyfinGenresData()

    return (
        <div className="genres-page">
            <MediaList
                items={items}
                infiniteData={infiniteData}
                isLoading={isLoading}
                type="genre"
                title={t('list.genres')}
                reviver={reviver}
                loadMore={loadMore}
                hidden={{
                    add_to_favorite: true,
                    remove_from_favorite: true,
                }}
            />
            {error && <div className="error">{error}</div>}
        </div>
    )
}
