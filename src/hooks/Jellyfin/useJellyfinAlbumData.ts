import { useQuery } from '@tanstack/react-query'
import { MediaItem } from '../../api/jellyfin'
import { useJellyfinContext } from '../../context/JellyfinContext/JellyfinContext'

interface JellyfinAlbumData {
    album: MediaItem | null
    tracks: MediaItem[]
    discCount: number
    loading: boolean
    error: string | null
}

export const useJellyfinAlbumData = (albumId: string) => {
    const api = useJellyfinContext()

    const { data, isFetching, isPending, error } = useQuery<JellyfinAlbumData, Error>({
        queryKey: ['albumData', albumId],
        queryFn: async () => {
            const { album, tracks } = await api.getAlbumDetails(albumId)

            const discNumbers = new Set(tracks.map(track => track.ParentIndexNumber || 1))
            const discCount = discNumbers.size

            return {
                album,
                tracks,
                discCount,
                loading: false,
                error: null,
            }
        },
    })

    return {
        ...data,
        loading: isFetching || isPending,
        error: error ? error.message : null,
        tracks: data?.tracks || [],
        discCount: data?.discCount || 1,
    }
}
