import { ___PAGE_PARAM_INDEX___ } from '../../../components/PlaybackManager'
import { useJellyfinContext } from '../../../context/JellyfinContext/JellyfinContext'
import { useJellyfinInfiniteData } from './useJellyfinInfiniteData'

export const useJellyfinFrequentlyPlayedData = () => {
    const api = useJellyfinContext()
    const itemsPerPage = 40

    return useJellyfinInfiniteData({
        queryKey: ['frequentlyPlayed'],
        queryFn: async ({ pageParam = 0 }) => {
            const startIndex = (pageParam as number) * itemsPerPage
            return await api.fetchFrequentlyPlayed(startIndex, itemsPerPage)
        },
        queryFnReviver: {
            fn: 'fetchFrequentlyPlayed',
            params: [___PAGE_PARAM_INDEX___, itemsPerPage],
        },
    })
}
