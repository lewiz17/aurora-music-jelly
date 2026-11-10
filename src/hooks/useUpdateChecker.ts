import { useMemo } from 'react'

/**
 * Update checks are disabled: the app is distributed privately and must not
 * reveal its origin by calling out to a public repository.
 * The hook keeps its original shape so callers do not need to change.
 */
export const useUpdateChecker = (_enabled: boolean) => {
    return useMemo(
        () => ({
            latestRelease: null,
            isCheckingUpdate: false,
            updateCheckError: null,
            updateStatus: null,
        }),
        []
    )
}
