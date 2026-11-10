import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { MediaList } from '../components/MediaList'
import { useI18n } from '../i18n/i18n'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { useJellyfinSearchPlaylistsData } from '../hooks/Jellyfin/Infinite/useJellyfinSearchPlaylistsData'

export const SearchPlaylists = () => {
    const { t } = useI18n()
    const { query } = useParams<{ query: string }>()
    const { setPageTitle } = usePageTitle()
    const {
        items: playlists,
        isLoading,
        error,
        infiniteData,
        loadMore,
        reviver,
    } = useJellyfinSearchPlaylistsData(query)

    useEffect(() => {
        if (query) {
            setPageTitle(`${t('search.all.playlists')} '${query}'`)
        }

        return () => setPageTitle('')
    }, [query, setPageTitle])

    if (isLoading && playlists.length === 0) return <Loader />
    if (error) return <div>{error}</div>
    if (!query) return <div>{t('search.enter')}</div>

    return (
        <div className="search-playlists-page">
            {playlists.length > 0 ? (
                <MediaList
                    items={playlists}
                    infiniteData={infiniteData}
                    isLoading={isLoading}
                    type="playlist"
                    title={`${t('search.all.playlists')} '${query}'`}
                    loadMore={loadMore}
                    reviver={reviver}
                />
            ) : (
                <div>{t('search.none.playlists')} '{query}'.</div>
            )}
        </div>
    )
}
