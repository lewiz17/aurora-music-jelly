import { QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, BrowserRouter as Router, Routes, useLocation, useSearchParams } from 'react-router-dom'
import './App.css'
import { Dropdown } from './components/Dropdown'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Main } from './components/Main'
import './components/MediaList.css'
import { Sidenav } from './components/Sidenav'
import { AudioStorageContextProvider } from './context/AudioStorageContext/AudioStorageContextProvider'
import { DownloadContextProvider } from './context/DownloadContext/DownloadContextProvider'
import { useDropdownContext } from './context/DropdownContext/DropdownContext'
import { DropdownContextProvider } from './context/DropdownContext/DropdownContextProvider'
import { HistoryContextProvider } from './context/HistoryContext/HistoryContextProvider'
import { JellyfinContextProvider } from './context/JellyfinContext/JellyfinContextProvider'
import { PageTitleProvider } from './context/PageTitleContext/PageTitleProvider'
import { usePlaybackContext } from './context/PlaybackContext/PlaybackContext'
import { PlaybackContextProvider } from './context/PlaybackContext/PlaybackContextProvider'
import { ScrollContextProvider } from './context/ScrollContext/ScrollContextProvider'
import { useSidenavContext } from './context/SidenavContext/SidenavContext'
import { SidenavContextProvider } from './context/SidenavContext/SidenavContextProvider'
import { ThemeContextProvider } from './context/ThemeContext/ThemeContextProvider'
import { AuroraConfigProvider } from './config/AuroraConfigProvider'
import { I18nProvider } from './i18n/I18nProvider'
import { ThemeApplier } from './theme/ThemeApplier'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import { InlineSearch } from './pages/Search'
import { persister, queryClient } from './queryClient'
import { Loader } from './components/Loader'
import { Suspense, lazy } from 'react'
// Routes are code-split: the first paint only ships what the login screen needs
const Album = lazy(() => import('./pages/Album').then(module => ({ default: module.Album })))
const AlbumArtists = lazy(() => import('./pages/AlbumArtists').then(module => ({ default: module.AlbumArtists })))
const Albums = lazy(() => import('./pages/Albums').then(module => ({ default: module.Albums })))
const Artist = lazy(() => import('./pages/Artist').then(module => ({ default: module.Artist })))
const Artists = lazy(() => import('./pages/Artists').then(module => ({ default: module.Artists })))
const ArtistTracks = lazy(() => import('./pages/ArtistTracks').then(module => ({ default: module.ArtistTracks })))
const Downloads = lazy(() => import('./pages/Downloads').then(module => ({ default: module.Downloads })))
const Favorites = lazy(() => import('./pages/Favorites').then(module => ({ default: module.Favorites })))
const FrequentlyPlayed = lazy(() => import('./pages/FrequentlyPlayed').then(module => ({ default: module.FrequentlyPlayed })))
const Genre = lazy(() => import('./pages/Genre').then(module => ({ default: module.Genre })))
const Genres = lazy(() => import('./pages/Genres').then(module => ({ default: module.Genres })))
const Home = lazy(() => import('./pages/Home').then(module => ({ default: module.Home })))
const InstantMix = lazy(() => import('./pages/InstantMix').then(module => ({ default: module.InstantMix })))
const Login = lazy(() => import('./pages/Login').then(module => ({ default: module.Login })))
const Lyrics = lazy(() => import('./pages/Lyrics').then(module => ({ default: module.Lyrics })))
const NowPlaying = lazy(() => import('./pages/NowPlaying').then(module => ({ default: module.NowPlaying })))
const NowPlayingLyrics = lazy(() => import('./pages/NowPlayingLyrics').then(module => ({ default: module.NowPlayingLyrics })))
const Playlist = lazy(() => import('./pages/Playlist').then(module => ({ default: module.Playlist })))
const Queue = lazy(() => import('./pages/Queue').then(module => ({ default: module.Queue })))
const RecentlyPlayed = lazy(() => import('./pages/RecentlyPlayed').then(module => ({ default: module.RecentlyPlayed })))
const SearchAlbums = lazy(() => import('./pages/SearchAlbums').then(module => ({ default: module.SearchAlbums })))
const SearchArtists = lazy(() => import('./pages/SearchArtists').then(module => ({ default: module.SearchArtists })))
const SearchGenres = lazy(() => import('./pages/SearchGenres').then(module => ({ default: module.SearchGenres })))
const SearchPlaylists = lazy(() => import('./pages/SearchPlaylists').then(module => ({ default: module.SearchPlaylists })))
const SearchResults = lazy(() => import('./pages/SearchResults').then(module => ({ default: module.SearchResults })))
const SearchTracks = lazy(() => import('./pages/SearchTracks').then(module => ({ default: module.SearchTracks })))
const Settings = lazy(() => import('./pages/Settings').then(module => ({ default: module.Settings })))
const Tracks = lazy(() => import('./pages/Tracks').then(module => ({ default: module.Tracks })))


const isValidAppRedirect = (path: string): boolean => {
    // must be relative and not redirect back to login
    return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login')
}

const RedirectToLogin = () => {
    const location = useLocation()
    const redirect = location.pathname + location.search
    if (redirect === '/') return <Navigate to="/login" />
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} />
}

const NavigateAfterLogin = () => {
    const [searchParams] = useSearchParams()
    const redirect = searchParams.get('redirect')
    const destination = redirect && isValidAppRedirect(redirect) ? redirect : '/'
    return <Navigate to={destination} />
}

export const App = () => {
    return (
        <ErrorBoundary>
            {window.__NPM_LIFECYCLE_EVENT__ === 'dev:nocache' ? (
                <QueryClientProvider client={queryClient}>
                    <AuroraConfigProvider>
                        <I18nProvider>
                            <ThemeApplier>
                                <RoutedApp />
                            </ThemeApplier>
                        </I18nProvider>
                    </AuroraConfigProvider>
                </QueryClientProvider>
            ) : (
                <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
                    <AuroraConfigProvider>
                        <I18nProvider>
                            <ThemeApplier>
                                <RoutedApp />
                            </ThemeApplier>
                        </I18nProvider>
                    </AuroraConfigProvider>
                </PersistQueryClientProvider>
            )}
        </ErrorBoundary>
    )
}

const RoutedApp = () => {
    const [auth, setAuth] = useState<AuthData | null>(() => {
        const savedAuth = localStorage.getItem('auth')
        return savedAuth ? JSON.parse(savedAuth) : null
    })
    const [isLoggingOut, setIsLoggingOut] = useState(false)
    const queryClient = useQueryClient()

    const handleLogin = (authData: AuthData) => {
        setAuth(authData)
        localStorage.setItem('auth', JSON.stringify(authData))
    }

    const handleLogout = async () => {
        setIsLoggingOut(true)
        localStorage.removeItem('repeatMode')
        setAuth(null)
        localStorage.removeItem('auth')
        setIsLoggingOut(false)
        queryClient.clear()
        await persister.removeClient()
    }

    useEffect(() => {
        if (!auth) {
            localStorage.removeItem('auth')
        }
    }, [auth])

    useEffect(() => {
        const isWindows = /Win/.test(navigator.userAgent)
        const isChromium = /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor)
        const isEdge = /Edg/.test(navigator.userAgent) && /Microsoft Corporation/.test(navigator.vendor)
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream // eslint-disable-line @typescript-eslint/no-explicit-any
        const isAndroid = /Android/i.test(navigator.userAgent)

        const isAndroidPWA =
            isAndroid &&
            (window.matchMedia('(display-mode: standalone)').matches ||
                window.matchMedia('(display-mode: minimal-ui)').matches ||
                window.matchMedia('(display-mode: fullscreen)').matches ||
                document.referrer.startsWith('android-app://')) // eslint-disable-line @typescript-eslint/no-explicit-any

        // env safe area inset not supported or unreliable in android pwa?
        if (isAndroidPWA) {
            document.getElementsByTagName('html')[0].classList.add('safeAreaFallbackAndroid')
        }

        if (isWindows && (isChromium || isEdge)) {
            document.getElementsByTagName('html')[0].classList.add('winOS')
        }

        if (isIOS) {
            document.getElementsByTagName('html')[0].classList.add('iOS')
        }

        // Needed for iOS, else you need to refresh page after changing orientation mode
        const updateOrientation = () => {
            const isIOSSafariNonPWA =
                isIOS &&
                !window.matchMedia('(display-mode: standalone)').matches &&
                !(navigator as any).standalone && // eslint-disable-line @typescript-eslint/no-explicit-any
                !window.matchMedia('(orientation: landscape)').matches

            const htmlElement = document.getElementsByTagName('html')[0]

            if (isIOS) {
                if (isIOSSafariNonPWA) {
                    htmlElement.classList.add('safeAreaFallback')
                } else {
                    htmlElement.classList.remove('safeAreaFallback')
                }
            }
        }

        updateOrientation()
        window.matchMedia('(orientation: landscape)').addEventListener('change', updateOrientation)

        return () => {
            window.matchMedia('(orientation: landscape)').removeEventListener('change', updateOrientation)
        }
    }, [])

    const actualApp = (
        <div className="music-app">
            <Routes>
                <Route path="/login" element={auth ? <NavigateAfterLogin /> : <Login onLogin={handleLogin} />} />
                <Route
                    path="/*"
                    element={
                        auth ? (
                            <JellyfinContextProvider auth={auth}>
                                <AudioStorageContextProvider>
                                    <SidenavContextProvider>
                                        <PlaybackContextProvider initialVolume={0.5} clearOnLogout={isLoggingOut}>
                                            <DownloadContextProvider>
                                                <DropdownContextProvider>
                                                    <MainLayout auth={auth} handleLogout={handleLogout} />
                                                    <Dropdown />
                                                </DropdownContextProvider>
                                            </DownloadContextProvider>
                                        </PlaybackContextProvider>
                                    </SidenavContextProvider>
                                </AudioStorageContextProvider>
                            </JellyfinContextProvider>
                        ) : (
                            <RedirectToLogin />
                        )
                    }
                />
            </Routes>
        </div>
    )

    return (
        <Router basename={import.meta.env.BASE_URL}>
            <HistoryContextProvider>
                <PageTitleProvider>
                    <ScrollContextProvider>
                        <ThemeContextProvider>{actualApp}</ThemeContextProvider>
                    </ScrollContextProvider>
                </PageTitleProvider>
            </HistoryContextProvider>
        </Router>
    )
}

interface AuthData {
    serverUrl: string
    token: string
    userId: string
    username: string
}

const MainLayout = ({ auth, handleLogout }: { auth: AuthData; handleLogout: () => void }) => {
    useDocumentTitle()

    const { showSidenav, toggleSidenav } = useSidenavContext()
    const dropdownContext = useDropdownContext()
    const { maxWidth } = usePlaybackContext()
    const isDropdownOpen = dropdownContext?.isOpen || false
    const isTouchDevice = dropdownContext?.isTouchDevice || false
    const isInteractionBlocked = dropdownContext?.isInteractionBlocked || false

    useEffect(() => {
        const root = document.documentElement
        if (maxWidth === 'wide') {
            root.style.setProperty('--interface-max-width', '100%')
        } else {
            root.style.setProperty('--interface-max-width', `${maxWidth}px`)
        }
    }, [maxWidth])

    const memoSettings = useCallback(() => {
        return <Settings onLogout={handleLogout} />
    }, [handleLogout])

    return (
        <Suspense fallback={<Loader />}>
        <Routes>
            <Route path="/nowplaying" element={<NowPlaying />} />
            <Route path="/nowplaying/lyrics" element={<NowPlayingLyrics />} />

            <Route
                path="*"
                element={
                    <div className={`interface` + (isInteractionBlocked ? ' touchBlocked' : '')}>
                        <div
                            className={
                                showSidenav || (isDropdownOpen && isTouchDevice)
                                    ? 'dimmer active noSelect'
                                    : 'dimmer noSelect'
                            }
                            onClick={showSidenav ? toggleSidenav : dropdownContext?.closeDropdown}
                        />

                        <Sidenav username={auth.username} />

                        <Routes>
                            <Route path="/" element={<Main content={Home}></Main>} />
                            <Route path="/search" element={<Main content={InlineSearch} />} />
                            <Route path="/tracks" element={<Main content={Tracks} filterType={'mediaItems'} />} />
                            <Route path="/lyrics" element={<Main content={Lyrics} />} />
                            <Route path="/albums" element={<Main content={Albums} filterType={'mediaItems'} />} />
                            <Route path="/album/:albumId" element={<Main content={Album} />} />
                            <Route path="/artists" element={<Main content={Artists} filterType={'mediaItems'} />} />
                            <Route path="/artist/:artistId" element={<Main content={Artist} />} />
                            <Route path="/artist/:artistId/tracks" element={<Main content={ArtistTracks} />} />
                            <Route
                                path="/albumartists"
                                element={<Main content={AlbumArtists} filterType={'mediaItems'} />}
                            />
                            <Route path="/genre/:genre" element={<Main content={Genre} filterType={'mediaItems'} />} />
                            <Route path="/genres" element={<Main content={Genres} filterType={'mediaItems'} />} />
                            <Route
                                path="/playlist/:playlistId"
                                element={<Main content={Playlist} filterType={'mediaItemsPlaylist'} />}
                            />
                            <Route path="/queue" element={<Main content={Queue} />} />
                            <Route path="/favorites" element={<Main content={Favorites} filterType={'favorites'} />} />
                            <Route path="/recently" element={<Main content={RecentlyPlayed} />} />
                            <Route path="/frequently" element={<Main content={FrequentlyPlayed} />} />
                            <Route path="/synced" element={<Main content={Downloads} filterType={'kind'} />} />
                            <Route path="/settings" element={<Main content={memoSettings} />} />
                            <Route path="/instantmix/:songId" element={<Main content={InstantMix} />} />
                            <Route path="/search/:query" element={<Main content={SearchResults} />} />
                            <Route path="/search/:query/tracks" element={<Main content={SearchTracks} />} />
                            <Route path="/search/:query/artists" element={<Main content={SearchArtists} />} />
                            <Route path="/search/:query/albums" element={<Main content={SearchAlbums} />} />
                            <Route path="/search/:query/playlists" element={<Main content={SearchPlaylists} />} />
                            <Route path="/search/:query/genres" element={<Main content={SearchGenres} />} />
                            <Route path="*" element={<Navigate to="/" />} />
                        </Routes>
                    </div>
                }
            />
        </Routes>
        </Suspense>
    )
}
