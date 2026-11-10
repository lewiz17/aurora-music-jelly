import { GearIcon } from '@primer/octicons-react'
import { ChangeEvent, WheelEvent } from 'react'
import { NavLink } from 'react-router-dom'
import '../App.css'
import { useDownloadContext } from '../context/DownloadContext/DownloadContext'
import { buildUrlWithSavedFilters } from '../context/FilterContext/FilterContext'
import { usePlaybackContext } from '../context/PlaybackContext/PlaybackContext'
import { useScrollContext } from '../context/ScrollContext/ScrollContext'
import { useSidenavContext } from '../context/SidenavContext/SidenavContext'
import { useJellyfinPlaylistsList } from '../hooks/Jellyfin/useJellyfinPlaylistsList'
import { useUpdateChecker } from '../hooks/useUpdateChecker'
import { formatFileSize } from '../utils/formatFileSize'
import './Sidenav.css'
import { DownloadingIcon, LyricsIcon } from './SvgIcons'
import { useI18n } from '../i18n/i18n'
import { useAuroraConfig } from '../config/AuroraConfig'
import { BrandLogo } from './BrandLogo'

export const Sidenav = (props: { username: string }) => {
    const playback = usePlaybackContext()
    const { updateStatus } = useUpdateChecker(playback.checkForUpdates)
    const { showSidenav, closeSidenav } = useSidenavContext()
    const { t } = useI18n()
    const config = useAuroraConfig()

    const { playlists, loading, error } = useJellyfinPlaylistsList()
    const { disabled, setDisabled } = useScrollContext()
    const { storageStats, queueCount } = useDownloadContext()

    const handleVolumeChange = (e: ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value)
        playback.setVolume(newVolume)
    }

    const handleVolumeScroll = (e: WheelEvent<HTMLInputElement>) => {
        e.stopPropagation()
        const step = e.deltaY > 0 ? -0.02 : 0.02
        const newVolume = Math.max(0, Math.min(1, playback.volume + step))
        playback.setVolume(newVolume)
    }

    return (
        <aside className="sidenav">
            <div className={'sidenav_wrapper' + (showSidenav ? ' active' : '') + (disabled ? ' lockscroll' : '')}>
                <div className="sidenav_header">
                    <NavLink to="/" onClick={closeSidenav} className="logo-link" aria-label={config.brandName}>
                        <BrandLogo className="logo" />
                    </NavLink>
                </div>
                <nav className="sidenav_content">
                    <ul className="links noSelect">
                        <li>
                            <NavLink to="/" onClick={closeSidenav}>
                                {t('nav.home')}
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to={buildUrlWithSavedFilters('/tracks')} onClick={closeSidenav}>
                                {t('nav.tracks')}
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to={buildUrlWithSavedFilters('/albums')} onClick={closeSidenav}>
                                {t('nav.albums')}
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to={buildUrlWithSavedFilters('/artists')} onClick={closeSidenav}>
                                {t('nav.artists')}
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to={buildUrlWithSavedFilters('/favorites')} onClick={closeSidenav}>
                                {t('nav.favorites')}
                            </NavLink>
                        </li>
                        <li>
                            <NavLink to="/search" onClick={closeSidenav}>
                                {t('nav.search')}
                            </NavLink>
                        </li>
                    </ul>

                    <div className="playlists">
                        {loading && playlists.length === 0 && (
                            <div className="indicator loading">{t('common.loading')}</div>
                        )}
                        {error && <div className="indicator error">{error}</div>}
                        {!loading && !error && playlists.length === 0 && (
                            <div className="indicator info">{t('common.empty')}</div>
                        )}
                        <div className="container noSelect">
                            {playlists.map(playlist => (
                                <NavLink
                                    to={buildUrlWithSavedFilters(`/playlist/${playlist.Id}`)}
                                    key={playlist.Id}
                                    onClick={closeSidenav}
                                    className={({ isActive }) => (isActive ? 'playlist active' : 'playlist')}
                                >
                                    {playlist.Name}
                                </NavLink>
                            ))}
                        </div>
                    </div>
                </nav>
                <div className="sidenav_footer">
                    <div className="volume">
                        <div className="indicator">{t('common.volume')}: {(playback.volume * 100).toFixed(0)}%</div>
                        <div className="control">
                            <input
                                type="range"
                                id="volume"
                                name="volume"
                                min="0"
                                max="1"
                                step="0.02"
                                value={playback.volume}
                                onChange={handleVolumeChange}
                                onWheel={handleVolumeScroll}
                                onMouseEnter={() => setDisabled(true)}
                                onMouseLeave={() => setDisabled(false)}
                            />
                        </div>
                    </div>
                    <div className="account">
                        <div className="status">
                            <div className="indicator">{config.brandName}</div>
                            <div className="username" title={props.username}>
                                {props.username}
                            </div>
                        </div>
                        <div className="actions">
                            {(playback.currentTrackLyrics?.Lyrics?.length || 0) > 0 && (
                                <NavLink to="/lyrics" className="icon lyrics" title={t('nav.lyrics')}>
                                    <LyricsIcon width={16} height={16} />
                                </NavLink>
                            )}

                            {(storageStats.trackCount > 0 || queueCount > 0) && (
                                <NavLink
                                    to="/synced"
                                    className={`icon synced ${queueCount > 0 ? 'active-sync' : ''}`}
                                    onClick={closeSidenav}
                                    title={`Synced - ${storageStats.trackCount} Track${
                                        storageStats.trackCount === 1 ? '' : 's'
                                    }${
                                        queueCount > 0
                                            ? ` (${queueCount} track${queueCount === 1 ? '' : 's'} in queue)`
                                            : ''
                                    } / ${formatFileSize(
                                        storageStats.trackCount === 0 ? 0 : storageStats?.indexedDB || 0
                                    )} Used`}
                                >
                                    <DownloadingIcon width={16} height={16} />
                                </NavLink>
                            )}

                            <NavLink
                                to="/settings"
                                className="icon settings"
                                onClick={closeSidenav}
                                title={updateStatus === 'available' ? 'Settings - Update available!' : 'Settings'}
                            >
                                <GearIcon size={16} />
                                {updateStatus === 'available' && (
                                    <div className="update-checker">
                                        <div className="dot" />
                                    </div>
                                )}
                            </NavLink>
                        </div>
                    </div>
                </div>
            </div>
        </aside>
    )
}
