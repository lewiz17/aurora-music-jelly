import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { ApiError, MediaItem } from '../../../api/jellyfin'
import { ___PAGE_PARAM_INDEX___ } from '../../../components/PlaybackManager'
import { useFilterContext } from '../../../context/FilterContext/FilterContext'
import { useJellyfinContext } from '../../../context/JellyfinContext/JellyfinContext'
import { useJellyfinInfiniteData } from './useJellyfinInfiniteData'

export const useJellyfinPlaylistData = (playlistId: string) => {
    const api = useJellyfinContext()
    const itemsPerPage = 40
    const { jellySort } = useFilterContext()

    const { data: playlistData, error: playlistError } = useQuery<MediaItem, ApiError>({
        queryKey: ['playlist', playlistId],
        queryFn: () => api.getPlaylist(playlistId),
    })

    const { data: totals, error: totalsError } = useQuery<
        {
            totalTrackCount: number
            totalPlaytime: number
            totalPlays: number
        },
        ApiError
    >({
        queryKey: ['playlistTotals', playlistId],
        queryFn: () => api.getPlaylistTotals(playlistId),
    })

    useEffect(() => {
        if (
            (playlistError || totalsError) instanceof ApiError &&
            (playlistError || totalsError)?.response?.status === 401
        ) {
            localStorage.removeItem('auth')
            window.location.href = '/login'
        }
    }, [playlistError, totalsError])

    const infiniteData = useJellyfinInfiniteData({
        queryKey: ['playlistTracks', playlistId, jellySort.sortBy, jellySort.sortOrder],
        queryFn: async ({ pageParam = 0 }) => {
            const startIndex = (pageParam as number) * itemsPerPage
            return await api.getPlaylistTracks(
                playlistId,
                startIndex,
                itemsPerPage,
                jellySort.sortBy,
                jellySort.sortOrder
            )
        },
        queryFnReviver: {
            fn: 'getPlaylistTracks',
            params: [playlistId, ___PAGE_PARAM_INDEX___, itemsPerPage, jellySort.sortBy, jellySort.sortOrder],
        },
    })

    const totalPlaytime = totals?.totalPlaytime || 0
    const totalTrackCount = totals?.totalTrackCount || 0
    const totalPlays = totals?.totalPlays || 0

    return {
        ...infiniteData,
        playlistData,
        totalPlaytime,
        totalTrackCount,
        totalPlays,
    }
}
