import { useQuery } from '@tanstack/react-query'
import { MediaItem } from '../../api/jellyfin'
import { useJellyfinContext } from '../../context/JellyfinContext/JellyfinContext'

export const useJellyfinInstantMixData = ({ songId }: { songId?: string }) => {
    const api = useJellyfinContext()

    const { data, isFetching, isPending, error } = useQuery<MediaItem[], Error>({
        queryKey: ['instantMix', songId],
        queryFn: async () => {
            if (!songId) {
                throw new Error('Song ID is required for instant mix')
            }

            return await api.getInstantMixFromSong(songId)
        },
        enabled: !!songId,
    })

    return {
        items: data || [],
        loading: isFetching || isPending,
        error: error ? error.message : null,
    }
}
