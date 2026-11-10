import { ReactNode, useEffect, useState } from 'react'
import { useAuroraConfig } from '../config/AuroraConfig'
import { THEMES, getTheme, withDerivedVars } from './themes'

const STORAGE_KEY = 'themeId'

export const useActiveThemeId = () => {
    const config = useAuroraConfig()
    const [themeId, setThemeId] = useState(() => localStorage.getItem(STORAGE_KEY) || config.defaultTheme || 'aurora')

    useEffect(() => {
        const onStorage = () => setThemeId(localStorage.getItem(STORAGE_KEY) || config.defaultTheme || 'aurora')
        window.addEventListener('aurora-theme-change', onStorage)
        return () => window.removeEventListener('aurora-theme-change', onStorage)
    }, [config.defaultTheme])

    return themeId
}

export const setActiveTheme = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    window.dispatchEvent(new Event('aurora-theme-change'))
}

/**
 * Applies the gradient/color variables of the active theme.
 * Runs above the router, so login and app screens are themed alike.
 */
export const ThemeApplier = ({ children }: { children: ReactNode }) => {
    const config = useAuroraConfig()
    const themeId = useActiveThemeId()
    const [appearance, setAppearance] = useState(() =>
        document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    )

    // Keep in sync with the appearance class toggled by ThemeContext/ main.tsx
    useEffect(() => {
        const observer = new MutationObserver(() => {
            setAppearance(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
        })
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const theme = getTheme(themeId, THEMES)
        const themed = {
            ...(appearance === 'dark' ? theme.dark : theme.light),
            ...(themeId === config.defaultTheme && config.themeVars
                ? appearance === 'dark'
                    ? config.themeVars.dark
                    : config.themeVars.light
                : {}),
        }
        const root = document.documentElement
        const withDerived = withDerivedVars(themed as Record<string, string>)
        for (const [key, value] of Object.entries(withDerived)) root.style.setProperty(key, value)
        root.setAttribute('data-theme', themeId)
        root.style.setProperty('--app-brand-gradient', themed['--app-gradient'] || 'none')
    }, [themeId, appearance, config.defaultTheme, config.themeVars])

    // Branding assets as CSS variables (so plain CSS can use them)
    useEffect(() => {
        const root = document.documentElement
        const map: Array<[string, string | null]> = [
            ['--brand-logo', config.assets.logo],
            ['--brand-logo-dark', config.assets.logoDark],
            ['--brand-login-bg', config.assets.loginBackground],
            ['--brand-album-placeholder', config.assets.albumPlaceholder],
            ['--brand-artist-placeholder', config.assets.artistPlaceholder],
        ]
        for (const [key, value] of map) {
            if (value) root.style.setProperty(key, `url(${value})`)
            else root.style.removeProperty(key)
        }
    }, [config.assets])

    return <>{children}</>
}
