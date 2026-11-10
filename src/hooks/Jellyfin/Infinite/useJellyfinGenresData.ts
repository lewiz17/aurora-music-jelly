import { ___PAGE_PARAM_INDEX___ } from '../../../components/PlaybackManager'
import { useFilterContext } from '../../../context/FilterContext/FilterContext'
import { useJellyfinContext } from '../../../context/JellyfinContext/JellyfinContext'
import { useJellyfinInfiniteData } from './useJellyfinInfiniteData'

export const useJellyfinGenresData = () => {
    const api = useJellyfinContext()
    const itemsPerPage = 40
    const { jellySort } = useFilterContext()

    return useJellyfinInfiniteData({
        queryKey: ['genres', jellySort.sortBy, jellySort.sortOrder],
        queryFn: async ({ pageParam = 0 }) => {
            const startIndex = (pageParam as number) * itemsPerPage
            return await api.getAllGenres(startIndex, itemsPerPage, jellySort.sortBy, jellySort.sortOrder)
        },
        queryFnReviver: {
            fn: 'getAllGenres',
            params: [___PAGE_PARAM_INDEX___, itemsPerPage, jellySort.sortBy, jellySort.sortOrder],
        },
    })
}
