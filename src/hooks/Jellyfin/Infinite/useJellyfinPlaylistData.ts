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

    // Playlists can be filled from outside the app (admin panel import adds tracks in chunks), so
    // opening one revalidates it instead of trusting a cached copy for 5 minutes. Cached data is
    // still shown instantly while the refresh runs.
    const { data: playlistData, error: playlistError } = useQuery<MediaItem, ApiError>({
        queryKey: ['playlist', playlistId],
        queryFn: () => api.getPlaylist(playlistId),
        staleTime: 0,
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
        staleTime: 0,
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
        // A playlist can hold the same track more than once. The play queue keeps duplicates
        // (PlaybackManager), so the visible list must too: if it were de-duplicated, every row
        // after a repeated track would be shifted and clicking it would play an earlier song.
        allowDuplicates: true,
        staleTime: 0,
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
