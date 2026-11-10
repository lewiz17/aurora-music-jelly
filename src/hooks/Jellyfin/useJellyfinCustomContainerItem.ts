import { useQuery } from '@tanstack/react-query'
import { useJellyfinContext } from '../../context/JellyfinContext/JellyfinContext'

export const useJellyfinCustomContainerItem = (customContainer: string, customContainerTitle: string) => {
    const api = useJellyfinContext()

    const { data, isFetching, isPending, error } = useQuery({
        queryKey: ['customContainerItem', customContainer],
        queryFn: async () => {
            return await api.createCustomContainerMediaItem(customContainer, customContainerTitle)
        },
        enabled: !!customContainer,
    })

    return {
        customItem: data,
        loading: isFetching || isPending,
        error: error ? error.message : null,
    }
}
