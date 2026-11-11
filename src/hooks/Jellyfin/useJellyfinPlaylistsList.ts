import { useQuery } from '@tanstack/react-query'
import { MediaItem } from '../../api/jellyfin'
import { useJellyfinContext } from '../../context/JellyfinContext/JellyfinContext'

/**
 * Playlists can be created outside the app (the admin panel imports them), so the app cannot
 * know about them through its own cache. The global 5 minute staleTime plus the cache persisted
 * in localStorage made a new list show up only after minutes. The list is tiny, so it is always
 * revalidated: cached data is shown instantly and refreshed in the background when the app opens,
 * when the tab regains focus, and every 30 s while the tab is visible.
 */
export const PLAYLISTS_REFRESH_OPTIONS = {
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
} as const

export const useJellyfinPlaylistsList = () => {
    const api = useJellyfinContext()

    const { data, isFetching, isPending, error } = useQuery<MediaItem[], Error>({
        queryKey: ['playlists'],
        queryFn: async () => {
            return await api.getAllPlaylists()
        },
        ...PLAYLISTS_REFRESH_OPTIONS,
    })

    return {
        playlists: data || [],
        loading: isFetching || isPending,
        error: error ? error.message : null,
    }
}
