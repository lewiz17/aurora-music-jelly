import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { MediaList } from '../components/MediaList'
import { useI18n } from '../i18n/i18n'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { useJellyfinSearchAlbumsData } from '../hooks/Jellyfin/Infinite/useJellyfinSearchAlbumsData'

export const SearchAlbums = () => {
    const { t } = useI18n()
    const { query } = useParams<{ query: string }>()
    const { setPageTitle } = usePageTitle()
    const { items: albums, isLoading, error, infiniteData, loadMore, reviver } = useJellyfinSearchAlbumsData(query)

    useEffect(() => {
        if (query) {
            setPageTitle(`${t('search.all.albums')} '${query}'`)
        }

        return () => setPageTitle('')
    }, [query, setPageTitle])

    if (isLoading && albums.length === 0) return <Loader />
    if (error) return <div>{error}</div>
    if (!query) return <div>{t('search.enter')}</div>

    return (
        <div className="search-albums-page">
            {albums.length > 0 ? (
                <MediaList
                    items={albums}
                    infiniteData={infiniteData}
                    isLoading={isLoading}
                    type="album"
                    title={`${t('search.all.albums')} '${query}'`}
                    albumDisplayMode="artist"
                    hidden={{ view_album: true }}
                    loadMore={loadMore}
                    reviver={reviver}
                />
            ) : (
                <div>{t('search.none.albums')} '{query}'.</div>
            )}
        </div>
    )
}
