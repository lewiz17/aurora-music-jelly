import { ___PAGE_PARAM_INDEX___ } from '../../../components/PlaybackManager'
import { useJellyfinContext } from '../../../context/JellyfinContext/JellyfinContext'
import { useJellyfinInfiniteData } from './useJellyfinInfiniteData'

export const useJellyfinArtistTracksData = (artistId: string) => {
    const api = useJellyfinContext()
    const itemsPerPage = 40

    return useJellyfinInfiniteData({
        queryKey: ['artistTracks', artistId],
        queryFn: async ({ pageParam = 0 }) => {
            const startIndex = (pageParam as number) * itemsPerPage
            const { Items } = await api.getArtistTracks(artistId, startIndex, itemsPerPage)
            return Items
        },
        queryFnReviver: {
            fn: 'getArtistTracks',
            params: [artistId, ___PAGE_PARAM_INDEX___, itemsPerPage],
        },
    })
}
