import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { usePageTitle } from '../context/PageTitleContext/PageTitleContext'
import { usePlaybackContext } from '../context/PlaybackContext/PlaybackContext'
import { getPageTitle } from '../utils/titleUtils'
import { useAuroraConfig } from '../config/AuroraConfig'
import { useI18n } from '../i18n/i18n'

export const useDocumentTitle = () => {
    const { currentTrack, isPlaying } = usePlaybackContext()
    const { pageTitle } = usePageTitle()
    const location = useLocation()
    const config = useAuroraConfig()
    const { t } = useI18n()

    useEffect(() => {
        if (currentTrack && isPlaying) {
            const artist = currentTrack.AlbumArtist || currentTrack.Artists?.[0] || ''
            document.title = artist ? `${currentTrack.Name} - ${artist}` : currentTrack.Name
        } else {
            document.title = `${getPageTitle(pageTitle, location, t)} - ${config.brandName}`
        }
    }, [currentTrack, isPlaying, pageTitle, location.pathname, location, config.brandName])
}
