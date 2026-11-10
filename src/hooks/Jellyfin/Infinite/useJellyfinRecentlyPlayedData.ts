import { ___PAGE_PARAM_INDEX___ } from '../../../components/PlaybackManager'
import { useJellyfinContext } from '../../../context/JellyfinContext/JellyfinContext'
import { useJellyfinInfiniteData } from './useJellyfinInfiniteData'

export const useJellyfinRecentlyPlayedData = () => {
    const api = useJellyfinContext()
    const itemsPerPage = 40

    return useJellyfinInfiniteData({
        queryKey: ['recentlyPlayed'],
        queryFn: async ({ pageParam = 0 }) => {
            const startIndex = (pageParam as number) * itemsPerPage
            return await api.fetchRecentlyPlayed(startIndex, itemsPerPage)
        },
        queryFnReviver: {
            fn: 'fetchRecentlyPlayed',
            params: [___PAGE_PARAM_INDEX___, itemsPerPage],
        },
    })
}
