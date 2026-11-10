import { useQuery } from '@tanstack/react-query'
import { createContext, useContext } from 'react'

export interface AuroraConfig {
    /** Name shown in the UI instead of the product name */
    brandName: string
    defaultTheme: string
    defaultLanguage: 'es' | 'en'
    /** Label of the access-code field on the login screen */
    codeFieldLabel: string
    codeFieldPlaceholder: string
    hideAbout: boolean
    assets: {
        logo: string | null
        logoDark: string | null
        icon: string | null
        loginBackground: string | null
        albumPlaceholder: string | null
        artistPlaceholder: string | null
    }
    /** Neutral name for the backend, so nothing in the UI says what it runs on */
    playerType: string
    themeVars?: { light: Record<string, string>; dark: Record<string, string> }
}

export const FALLBACK_CONFIG: AuroraConfig = {
    brandName: 'Aurora Music',
    defaultTheme: 'aurora',
    defaultLanguage: 'es',
    codeFieldLabel: 'Código de acceso',
    codeFieldPlaceholder: 'Escribe el código que te compartieron',
    hideAbout: true,
    assets: {
        logo: null,
        logoDark: null,
        icon: null,
        loginBackground: null,
        albumPlaceholder: null,
        artistPlaceholder: null,
    },
    playerType: 'Aurora',
}

const fetchConfig = async (): Promise<AuroraConfig> => {
    try {
        const response = await fetch('/api/app-config', { cache: 'no-store' })
        if (!response.ok) throw new Error('config unavailable')
        const data = await response.json()
        return { ...FALLBACK_CONFIG, ...data, assets: { ...FALLBACK_CONFIG.assets, ...(data.assets || {}) } }
    } catch {
        // The app can still be used as a plain Jellyfin client if the gateway is not present
        return FALLBACK_CONFIG
    }
}

export const useAuroraConfigQuery = () =>
    useQuery<AuroraConfig, Error>({
        queryKey: ['aurora-config'],
        queryFn: fetchConfig,
        staleTime: 5 * 60 * 1000,
    })

export const AuroraConfigContext = createContext<AuroraConfig>(FALLBACK_CONFIG)
export const useAuroraConfig = () => useContext(AuroraConfigContext)
