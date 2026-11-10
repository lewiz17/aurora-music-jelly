import { useQuery } from '@tanstack/react-query'
import { useJellyfinContext } from '../../context/JellyfinContext/JellyfinContext'

export const useJellyfinTrackInfo = (trackId: string) => {
    const api = useJellyfinContext()

    const { data, isFetching, isPending, error } = useQuery({
        queryKey: ['trackInfo', trackId],
        queryFn: async () => await api.getTrackInfo(trackId),
        enabled: !!trackId,
    })

    return {
        ...data,
        loading: isFetching || isPending,
        error: error ? error.message : null,
    }
}
