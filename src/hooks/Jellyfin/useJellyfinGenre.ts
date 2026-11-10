import { useQuery } from '@tanstack/react-query'
import { useJellyfinContext } from '../../context/JellyfinContext/JellyfinContext'

export const useJellyfinGenre = (genre: string) => {
    const api = useJellyfinContext()

    const { data, isFetching, isPending, error } = useQuery({
        queryKey: ['genre', genre],
        queryFn: async () => {
            return await api.getGenreByName(genre)
        },
    })

    return {
        mediaItem: data,
        loading: isFetching || isPending,
        error: error ? error.message : null,
    }
}
