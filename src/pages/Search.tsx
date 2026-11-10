import { useEffect, useRef, useState } from 'react'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { Link, useNavigate } from 'react-router-dom'
import { MediaItem } from '../api/jellyfin'
import { JellyImg } from '../components/JellyImg'
import { InlineLoader } from '../components/InlineLoader'
import { useJellyfinSearch } from '../hooks/Jellyfin/useJellyfinSearch'
import { usePlaybackContext } from '../context/PlaybackContext/PlaybackContext'
import { useI18n } from '../i18n/i18n'
import { PlaystateAnimationSearch, SearchClearIcon, SearchIcon } from '../components/SvgIcons'

/**
 * Search that lives in the main view instead of the sidenav.
 * Results update as you type; Enter opens the dedicated results page.
 */
export const InlineSearch = () => {
    const { t } = useI18n()
    const navigate = useNavigate()
    const playback = usePlaybackContext()
    const { setPageTitle } = usePageTitle()
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        setPageTitle(t('nav.search'))
        return () => setPageTitle('')
    }, [setPageTitle, t])

    const [query, setQuery] = useState(new URLSearchParams(window.location.search).get('q') || '')
    const { searchResults, searchLoading, searchAttempted } = useJellyfinSearch(query)

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    // Ctrl/Cmd+K anywhere focuses the in-view search
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault()
                inputRef.current?.focus()
                inputRef.current?.select()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    const songs = searchResults.filter(item => item.Type === 'Audio')
    const artists = searchResults.filter(item => item.Type === 'MusicArtist')
    const albums = searchResults.filter(item => item.Type === 'MusicAlbum')
    const playlists = searchResults.filter(item => item.Type === 'Playlist')

    const openItem = (item: MediaItem) => {
        if (item.Type === 'Audio') {
            playback.setCurrentPlaylistSimple({
                playlist: songs.length ? songs : [item],
                title: 'Resultados',
            })
            playback.playTrack(Math.max(0, songs.findIndex(song => song.Id === item.Id)))
            return
        }
        if (item.Type === 'MusicArtist') return navigate(`/artist/${item.Id}`)
        if (item.Type === 'MusicAlbum') return navigate(`/album/${item.Id}`)
        if (item.Type === 'Playlist') return navigate(`/playlist/${item.Id}`)
        navigate(`/search/${encodeURIComponent(query)}`)
    }

    const row = (item: MediaItem, sub: string) => (
        <div
            key={item.Id}
            className="inline-search-row"
            role="button"
            tabIndex={0}
            onClick={() => openItem(item)}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openItem(item)
                }
            }}
        >
            <div className="thumb">
                <JellyImg item={item} type="Primary" width={84} height={84} />
            </div>
            <div className="meta">
                <div className="name">{item.Name}</div>
                <div className="sub">{sub}</div>
            </div>
        </div>
    )

    return (
        <div className="inline-search">
            <div className="inline-search-input">
                <span className="search-icon noSelect">
                    {searchLoading ? <InlineLoader /> : <SearchIcon width={15} height={15} />}
                </span>
                <input
                    ref={inputRef}
                    type="search"
                    value={query}
                    placeholder={t('nav.searchPlaceholder')}
                    aria-label={t('nav.search')}
                    onChange={event => setQuery(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && query.trim()) {
                            navigate(`/search/${encodeURIComponent(query.trim())}`)
                        }
                    }}
                />
                {query && (
                    <button
                        type="button"
                        className="search-clear"
                        aria-label={t('common.cancel')}
                        onClick={() => {
                            setQuery('')
                            inputRef.current?.focus()
                        }}
                    >
                        <SearchClearIcon width={13} height={13} />
                    </button>
                )}
            </div>

            {!query.trim() && (
                <div className="inline-search-empty">
                    <PlaystateAnimationSearch width={22} height={22} /> {t('search.hint')}
                </div>
            )}

            {query.trim() && !searchLoading && searchAttempted && searchResults.length === 0 && (
                <div className="inline-search-empty">
                    {t('search.empty')} <strong>“{query}”</strong>
                </div>
            )}

            {songs.length > 0 && (
                <div className="inline-search-section">
                    <div className="title">{t('search.tracks')}</div>
                    {songs.slice(0, 8).map(song =>
                        row(song, song.Artists?.join(', ') || song.AlbumArtist || '')
                    )}
                    <Link className="textlink" to={`/search/${encodeURIComponent(query)}/tracks`}>
                        {t('search.viewAll')}
                    </Link>
                </div>
            )}

            {artists.length > 0 && (
                <div className="inline-search-section">
                    <div className="title">{t('search.artists')}</div>
                    {artists.slice(0, 4).map(artist => row(artist, t('common.artists')))}
                </div>
            )}

            {albums.length > 0 && (
                <div className="inline-search-section">
                    <div className="title">{t('search.albums')}</div>
                    {albums.slice(0, 6).map(album => row(album, album.AlbumArtist || t('common.albums')))}
                </div>
            )}

            {playlists.length > 0 && (
                <div className="inline-search-section">
                    <div className="title">{t('search.playlists')}</div>
                    {playlists.slice(0, 4).map(playlist => row(playlist, t('nav.playlists')))}
                </div>
            )}
        </div>
    )
}
