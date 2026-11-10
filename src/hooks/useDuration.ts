import { useEffect, useState } from 'react'
import { usePlaybackContext } from '../context/PlaybackContext/PlaybackContext'

export const useDuration = () => {
    const playback = usePlaybackContext()
    const audio = playback.audioRef

    const [progress, setProgress] = useState(audio.currentTime || 0)
    const [duration, setDuration] = useState(audio.duration || 0)

    useEffect(() => {
        if (!audio) return

        const updateProgress = () => {
            setProgress(audio.currentTime)
            setDuration(audio.duration)
        }

        audio.addEventListener('timeupdate', updateProgress)
        audio.addEventListener('loadedmetadata', updateProgress)

        return () => {
            audio.removeEventListener('timeupdate', updateProgress)
            audio.removeEventListener('loadedmetadata', updateProgress)
        }
    }, [audio])

    return { progress, duration }
}
