import { useQuery } from '@tanstack/react-query'
import { MediaItem } from '../../api/jellyfin'
import { useJellyfinContext } from '../../context/JellyfinContext/JellyfinContext'

export const useJellyfinPlaylistsList = () => {
    const api = useJellyfinContext()

    const { data, isFetching, isPending, error } = useQuery<MediaItem[], Error>({
        queryKey: ['playlists'],
        queryFn: async () => {
            return await api.getAllPlaylists()
        },
    })

    return {
        playlists: data || [],
        loading: isFetching || isPending,
        error: error ? error.message : null,
    }
}
