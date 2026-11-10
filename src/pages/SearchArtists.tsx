import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { MediaList } from '../components/MediaList'
import { useI18n } from '../i18n/i18n'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { useJellyfinSearchArtistsData } from '../hooks/Jellyfin/Infinite/useJellyfinSearchArtistsData'

export const SearchArtists = () => {
    const { t } = useI18n()
    const { query } = useParams<{ query: string }>()
    const { setPageTitle } = usePageTitle()
    const { items: artists, isLoading, error, infiniteData, loadMore, reviver } = useJellyfinSearchArtistsData(query)

    useEffect(() => {
        if (query) {
            setPageTitle(`${t('search.all.artists')} '${query}'`)
        }

        return () => setPageTitle('')
    }, [query, setPageTitle])

    if (isLoading && artists.length === 0) return <Loader />
    if (error) return <div>{error}</div>
    if (!query) return <div>{t('search.enter')}</div>

    return (
        <div className="search-artists-page">
            {artists.length > 0 ? (
                <MediaList
                    items={artists}
                    infiniteData={infiniteData}
                    isLoading={isLoading}
                    type="artist"
                    title={`${t('search.all.artists')} '${query}'`}
                    hidden={{ view_artist: true }}
                    loadMore={loadMore}
                    reviver={reviver}
                />
            ) : (
                <div>{t('search.none.artists')} '{query}'.</div>
            )}
        </div>
    )
}
