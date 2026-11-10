import { Location } from 'react-router-dom'
import { TranslateFn } from '../i18n/i18n'

export const getPageTitle = (pageTitle: string, location: Location, t: TranslateFn): string => {
    // Return pageTitle if set (e.g., by SearchResults), otherwise fallback to defaults
    if (pageTitle) return pageTitle

    if (location.pathname.startsWith('/album/')) return t('list.albums')
    if (location.pathname.startsWith('/artist/')) {
        if (location.pathname.includes('/tracks')) return t('list.tracks')
        return t('list.artists')
    }
    if (location.pathname.startsWith('/genre/')) return t('nav.genres')
    if (location.pathname.startsWith('/playlist/')) return t('list.playlist')
    if (location.pathname.startsWith('/search/')) {
        const query = decodeURIComponent(location.pathname.split('/search/')[1])
        return `${t('list.empty.search')} '${query}'`
    }
    if (location.pathname.startsWith('/instantmix/')) return t('list.instantMix')

    switch (location.pathname) {
        case '/':
            return t('nav.home')
        case '/tracks':
            return t('list.tracks')
        case '/lyrics':
            return t('nav.lyrics')
        case '/albums':
            return t('list.albums')
        case '/artists':
            return t('list.artists')
        case '/albumartists':
            return t('list.albumArtists')
        case '/genres':
            return t('list.genres')
        case '/favorites':
            return t('list.favorites')
        case '/settings':
            return t('settings.title')
        case '/synced':
            return t('list.downloads')
        case '/nowplaying':
            return t('list.currentTrack')
        case '/nowplaying/lyrics':
            return `${t('list.currentTrack')} / ${t('lyrics.title')}`
        case '/recently':
            return t('list.recently')
        case '/frequently':
            return t('list.frequently')
        case '/queue':
            return t('list.queue')
        default:
            return t('nav.home')
    }
}
