import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Loader } from '../components/Loader'
import { MediaList } from '../components/MediaList'
import { useI18n } from '../i18n/i18n'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { useJellyfinSearchTracksData } from '../hooks/Jellyfin/Infinite/useJellyfinSearchTracksData'

export const SearchTracks = () => {
    const { t } = useI18n()
    const { query } = useParams<{ query: string }>()
    const { setPageTitle } = usePageTitle()
    const { items: tracks, isLoading, error, infiniteData, loadMore, reviver } = useJellyfinSearchTracksData(query)

    useEffect(() => {
        if (query) {
            setPageTitle(`${t('search.all.tracks')} '${query}'`)
        }

        return () => setPageTitle('')
    }, [query, setPageTitle])

    if (isLoading && tracks.length === 0) return <Loader />
    if (error) return <div>{error}</div>
    if (!query) return <div>{t('search.enter')}</div>

    return (
        <div className="search-tracks-page">
            {tracks.length > 0 ? (
                <MediaList
                    items={tracks}
                    infiniteData={infiniteData}
                    isLoading={isLoading}
                    type="song"
                    title={`${t('search.all.tracks')} '${query}'`}
                    loadMore={loadMore}
                    reviver={reviver}
                />
            ) : (
                <div>{t('search.none.tracks')} '{query}'.</div>
            )}
        </div>
    )
}
