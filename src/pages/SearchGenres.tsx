import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { MediaList } from '../components/MediaList'
import { useI18n } from '../i18n/i18n'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { useJellyfinSearchGenresData } from '../hooks/Jellyfin/Infinite/useJellyfinSearchGenresData'

export const SearchGenres = () => {
    const { t } = useI18n()
    const { query } = useParams<{ query: string }>()
    const { setPageTitle } = usePageTitle()
    const { items: genres, isLoading, error, infiniteData, loadMore, reviver } = useJellyfinSearchGenresData(query)

    useEffect(() => {
        if (query) {
            setPageTitle(`${t('search.all.genres')} '${query}'`)
        }

        return () => setPageTitle('')
    }, [query, setPageTitle])

    if (isLoading && genres.length === 0) return <Loader />
    if (error) return <div>{error}</div>
    if (!query) return <div>{t('search.enter')}</div>

    return (
        <div className="search-genres-page">
            {genres.length > 0 ? (
                <MediaList
                    items={genres}
                    infiniteData={infiniteData}
                    isLoading={isLoading}
                    type="genre"
                    title={`${t('search.all.genres')} '${query}'`}
                    loadMore={loadMore}
                    reviver={reviver}
                />
            ) : (
                <div>{t('search.none.genres')} '{query}'.</div>
            )}
        </div>
    )
}
