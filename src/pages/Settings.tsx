
import { CheckCircleFillIcon } from '@primer/octicons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAudioStorageContext } from '../context/AudioStorageContext/AudioStorageContext'
import { useDownloadContext } from '../context/DownloadContext/DownloadContext'
import { useJellyfinContext } from '../context/JellyfinContext/JellyfinContext'
import { usePlaybackContext } from '../context/PlaybackContext/PlaybackContext'
import { useThemeContext } from '../context/ThemeContext/ThemeContext'
import { useI18n } from '../i18n/i18n'
import { setActiveTheme } from '../theme/ThemeApplier'
import { persister } from '../queryClient'
import { formatFileSize } from '../utils/formatFileSize'
import './Settings.css'

export const Settings = ({ onLogout }: { onLogout: () => void }) => {
    const navigate = useNavigate()
    const api = useJellyfinContext()
    const audioStorage = useAudioStorageContext()

    const { theme, toggleTheme, themeId, themes } = useThemeContext()
    const { t, language, setLanguage } = useI18n()

    const [lastLogin, setLastLogin] = useState<string | null>(null)
    const { sessionPlayCount, resetSessionCount, bitrate, setBitrate } = usePlaybackContext()
    const playback = usePlaybackContext()
    const queryClient = useQueryClient()
    const { storageStats, refreshStorageStats, queueCount, clearQueue } = useDownloadContext()

    const [clearing, setClearing] = useState(false)

    useEffect(() => {
        const fetchData = async () => {
            try {
                const [user] = await Promise.all([api.fetchUserInfo()])

                if (user.LastLoginDate) {
                    const date = new Date(user.LastLoginDate)
                    const formatted = date
                        .toLocaleString(language === 'es' ? 'es-CO' : 'en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            year: 'numeric',
                            hour12: true,
                        })
                        .replace(/,/, '')
                    setLastLogin(formatted)
                } else {
                    setLastLogin(null)
                }

            } catch (error) {
                console.error('Error fetching data:', error)
            }
        }

        fetchData()
    }, [api])

    const handleLogout = () => {
        playback.audioRef.pause()
        playback.crossfadeRef.pause()
        resetSessionCount()
        onLogout()
        navigate('/login')
    }

    const handleClearAll = useCallback(async () => {
        if (!confirm('Are you sure you want to clear all downloads? This cannot be undone.')) {
            return
        }

        try {
            setClearing(true)
            await audioStorage.clearAllDownloads()
            queryClient.clear()
            await persister.removeClient()
            clearQueue()
            await refreshStorageStats()
        } catch (error) {
            console.error('Failed to clear downloads:', error)
        } finally {
            setClearing(false)
        }
    }, [audioStorage, clearQueue, queryClient, refreshStorageStats])

    const reloadApp = async () => {
        queryClient.clear()
        await persister.removeClient()

        if (navigator.onLine) {
            const registrations = await navigator.serviceWorker?.getRegistrations?.().catch(() => [])
            await Promise.all((registrations || []).map(r => r.unregister()))
            await Promise.all(((await window.caches?.keys()) || []).map(c => window.caches.delete(c)))
        }

        window.location.reload()
    }

    return (
        <div className="settings-page">
            <div className="section appearance">
                <div className="title">Appearance</div>
                <div className="container">
                    <div className="options primary noSelect">
                        <div
                            className={`option light ${theme === 'light' ? 'active' : ''}`}
                            onClick={() => toggleTheme('light')}
                        >
                            <div className="visual" />
                            <div className="desc">Light</div>
                        </div>
                        <div
                            className={`option dark ${theme === 'dark' ? 'active' : ''}`}
                            onClick={() => toggleTheme('dark')}
                        >
                            <div className="visual" />
                            <div className="desc">Dark</div>
                        </div>
                        <div
                            className={`option system ${theme === 'system' ? 'active' : ''}`}
                            onClick={() => toggleTheme('system')}
                        >
                            <div className="visual" />
                            <div className="desc">System</div>
                        </div>
                    </div>
                    <div className="options secondary noSelect">
                        <div
                            className={`option classic ${playback.maxWidth === '800' ? 'active' : ''}`}
                            onClick={() => playback.setMaxWidth('800')}
                        >
                            <div className="desc">Classic</div>
                        </div>
                        <div
                            className={`option medium ${playback.maxWidth === '1000' ? 'active' : ''}`}
                            onClick={() => playback.setMaxWidth('1000')}
                        >
                            <div className="desc">Medium</div>
                        </div>
                        <div
                            className={`option large ${playback.maxWidth === '1400' ? 'active' : ''}`}
                            onClick={() => playback.setMaxWidth('1400')}
                        >
                            <div className="desc">Large</div>
                        </div>
                        <div
                            className={`option wide ${playback.maxWidth === 'wide' ? 'active' : ''}`}
                            onClick={() => playback.setMaxWidth('wide')}
                        >
                            <div className="desc">Wide</div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="section quality">
                <div className="title">Audio Quality</div>
                <div className="container">
                    <div className="info">
                        <div className="subtitle">Streaming & Offline Sync</div>
                        <div className="subdesc">
                            Adjusting audio quality enables server-side transcoding, converting to a compatible format
                            with a lower bitrate for smoother streaming or efficient offline syncing
                        </div>
                    </div>
                    <div className="options noSelect">
                        <div className={'option source' + (!bitrate ? ' active' : '')} onClick={() => setBitrate(0)}>
                            <div className="status">
                                <CheckCircleFillIcon size={16} />
                            </div>
                            <div className="details">
                                <div className="title">Source</div>
                                <div className="desc">
                                    Direct playback of the original audio source without modifications
                                </div>
                            </div>
                        </div>
                        <div
                            className={'option high' + (bitrate === 320000 ? ' active' : '')}
                            onClick={() => setBitrate(320000)}
                        >
                            <div className="status">
                                <CheckCircleFillIcon size={16} />
                            </div>
                            <div className="details">
                                <div className="title">
                                    High <span className="bitrate">320 kbps</span>
                                </div>
                                <div className="desc">
                                    Superior sound quality, perfect for immersive listening with moderate data usage
                                </div>
                            </div>
                        </div>
                        <div
                            className={'option medium' + (bitrate === 256000 ? ' active' : '')}
                            onClick={() => setBitrate(256000)}
                        >
                            <div className="status">
                                <CheckCircleFillIcon size={16} />
                            </div>
                            <div className="details">
                                <div className="title">
                                    Medium <span className="bitrate">256 kbps</span>
                                </div>
                                <div className="desc">
                                    Crisp audio with a balanced blend of quality and data efficiency
                                </div>
                            </div>
                        </div>
                        <div
                            className={'option low' + (bitrate === 192000 ? ' active' : '')}
                            onClick={() => setBitrate(192000)}
                        >
                            <div className="status">
                                <CheckCircleFillIcon size={16} />
                            </div>
                            <div className="details">
                                <div className="title">
                                    Low <span className="bitrate">192 kbps</span>
                                </div>
                                <div className="desc">Solid quality tailored for streaming with reduced bandwidth</div>
                            </div>
                        </div>
                        <div
                            className={'option minimal' + (bitrate === 128000 ? ' active' : '')}
                            onClick={() => setBitrate(128000)}
                        >
                            <div className="status">
                                <CheckCircleFillIcon size={16} />
                            </div>
                            <div className="details">
                                <div className="title">
                                    Minimal <span className="bitrate">128 kbps</span>
                                </div>
                                <div className="desc">
                                    Essential audio quality optimized for the lowest data consumption
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="section offline-sync">
                <div className="primary">
                    <div className="container">
                        <div className="title">Offline Sync</div>
                        <div className="desc">
                            Synced - <span className="number">{storageStats.trackCount}</span> Track
                            {storageStats.trackCount === 1 ? '' : 's'}
                            {queueCount > 0 ? (
                                <>
                                    {' '}
                                    (<span className="number">{queueCount}</span> track{queueCount === 1 ? '' : 's'} in
                                    queue)
                                </>
                            ) : (
                                ''
                            )}{' '}
                            /{' '}
                            <span className="number">
                                {formatFileSize(storageStats.trackCount === 0 ? 0 : storageStats?.indexedDB || 0)}
                            </span>{' '}
                            Used
                        </div>
                    </div>
                    <div className="options noSelect">
                        <div className="option">
                            {(storageStats.trackCount > 0 || queueCount > 0 || !audioStorage.isInitialized()) && (
                                <button className="btn clear" onClick={handleClearAll} disabled={clearing}>
                                    {clearing ? 'Clearing...' : 'Clear All'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                <div className="desc">
                    <div className="info">
                        Cache your music library for seamless offline playback, with new tracks auto-syncing to saved
                        playlists, albums, or artists.{' '}
                        <Link to="/synced" className="textlink">
                            Browse music library
                        </Link>
                        , available once tracks are synced
                    </div>
                </div>
            </div>
            <div className={'section preload' + (playback.isPreloadActive ? '' : ' disabled')}>
                <div className="primary">
                    <div className="container">
                        <div className="title">Preload</div>
                    </div>
                    <div className="options noSelect">
                        <div className="option adjustable">
                            <div className="number current">{playback.preloadDuration}s</div>
                            <div className="slider">
                                <input
                                    type="range"
                                    id="preload"
                                    name="preload"
                                    min="2"
                                    max="30"
                                    step="1"
                                    value={playback.preloadDuration}
                                    onChange={e => playback.setPreloadDuration(Number(e.target.value))}
                                />
                            </div>
                            <div className="number">30s</div>
                        </div>
                        <div className="option">
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    checked={playback.isPreloadActive}
                                    onChange={e => playback.setIsPreloadActive(e.target.checked)}
                                ></input>
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div className="desc">
                    <div className="info">
                        Preload the next track to ensure seamless playback, eliminating buffering delays for a smoother,
                        uninterrupted listening experience, even with high-quality audio or slower connections
                    </div>
                </div>
            </div>
            <div className={'section crossfade' + (playback.isCrossfadeActive ? '' : ' disabled')}>
                <div className="primary">
                    <div className="container">
                        <div className="title">Crossfade</div>
                    </div>
                    <div className="options noSelect">
                        <div className="option adjustable">
                            <div className="number current">{playback.crossfadeDuration}s</div>
                            <div className="slider">
                                <input
                                    type="range"
                                    id="crossfade"
                                    name="crossfade"
                                    min="1"
                                    max="12"
                                    step="1"
                                    value={playback.crossfadeDuration}
                                    onChange={e => playback.setCrossfadeDuration(Number(e.target.value))}
                                />
                            </div>
                            <div className="number">12s</div>
                        </div>
                        <div className="option">
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    checked={playback.isCrossfadeActive}
                                    onChange={e => playback.setIsCrossfadeActive(e.target.checked)}
                                ></input>
                                <span className="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
                <div className="desc">
                    <div className="info">
                        Smoothly transition between tracks by gradually fading out the current song while simultaneously
                        fading in the next, creating a seamless and immersive listening experience
                    </div>
                </div>
            </div>
            <div className="section interface-ui">
                <div className="title">Interface</div>
                <div className="inner row">
                    <div className="container">
                        <div className="desc">
                            <div className="subtitle">Filter state</div>
                            <div className="subdesc">
                                Remember selected filters across sessions for a consistent experience
                            </div>
                        </div>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={playback.rememberFilters}
                                onChange={e => playback.setRememberFilters(e.target.checked)}
                            ></input>
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>
                <div className="inner row">
                    <div className="container">
                        <div className="desc">
                            <div className="subtitle">Queue protection</div>
                            <div className="subdesc">
                                Warn before overwriting the active queue if it includes manually added tracks
                            </div>
                        </div>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={playback.warnBeforeOverwriteQueue}
                                onChange={e => playback.setWarnBeforeOverwriteQueue(e.target.checked)}
                            ></input>
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>
            </div>
            <div className="section lyrics">
                <div className="title">Lyrics</div>
                <div className="inner row">
                    <div className="container">
                        <div className="desc">
                            <div className="subtitle">Timestamps</div>
                            <div className="subdesc">Show timestamps with the synchronized lyrics</div>
                        </div>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={playback.lyricsTimestamps}
                                onChange={e => playback.setLyricsTimestamps(e.target.checked)}
                            ></input>
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>
                <div className="inner row">
                    <div className="container">
                        <div className="desc">
                            <div className="subtitle">Alignment</div>
                            <div className="subdesc">
                                Center lyrics for a different look, overriding the default left alignment
                            </div>
                        </div>
                        <label className="switch">
                            <input
                                type="checkbox"
                                checked={playback.centeredLyrics}
                                onChange={e => playback.setCenteredLyrics(e.target.checked)}
                            ></input>
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>
            </div>
            <div className="section themes">
                <div className="title">{t('settings.theme')}</div>
                <div className="desc">
                    <div className="theme-grid">
                        {themes.map(themeOption => (
                            <button
                                type="button"
                                key={themeOption.id}
                                className={`theme-swatch ${themeId === themeOption.id ? 'active' : ''}`}
                                onClick={() => setActiveTheme(themeOption.id)}
                                aria-pressed={themeId === themeOption.id}
                            >
                                <span
                                    className="preview"
                                    style={{
                                        backgroundImage: `linear-gradient(135deg, ${themeOption.swatch[0]} 0%, ${themeOption.swatch[1]} 100%)`,
                                    }}
                                />
                                <span className="label">{themeOption.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
            <div className="section language">
                <div className="title">{t('settings.language')}</div>
                <div className="inner row">
                    <div className="options secondary noSelect">
                        <div
                            className={`option ${language === 'es' ? 'active' : ''}`}
                            onClick={() => setLanguage('es')}
                            role="button"
                            tabIndex={0}
                            onKeyDown={event => event.key === 'Enter' && setLanguage('es')}
                        >
                            <div className="desc">Español</div>
                        </div>
                        <div
                            className={`option ${language === 'en' ? 'active' : ''}`}
                            onClick={() => setLanguage('en')}
                            role="button"
                            tabIndex={0}
                            onKeyDown={event => event.key === 'Enter' && setLanguage('en')}
                        >
                            <div className="desc">English</div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="section session">
                <div className="title">{t('settings.session')}</div>
                <div className="desc">
                    <p>
                        {t('settings.lastLogin')}: {lastLogin || '—'}
                    </p>
                    <p>
                        {t('settings.played')} {sessionPlayCount ?? 0}{' '}
                        {sessionPlayCount === 1 ? t('common.tracks').slice(0, -1) : t('common.tracks')}{' '}
                        {t('settings.sinceLogin')}
                    </p>
                </div>
                <div className="actions noSelect">
                    <button onClick={handleLogout} className="btn logout">
                        {t('settings.logout')}
                    </button>

                    <button onClick={reloadApp} className="btn reload" title={t('settings.reloadHint')}>
                        {t('settings.reload')}
                    </button>
                </div>
            </div>
        </div>
    )
}
