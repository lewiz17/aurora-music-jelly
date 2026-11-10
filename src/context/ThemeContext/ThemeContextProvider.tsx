import { ReactNode, useEffect, useState } from 'react'
import { useAuroraConfig } from '../../config/AuroraConfig'
import { THEMES, ThemeDefinition, applyThemeVars, getTheme } from '../../theme/themes'
import { ThemeContext } from './ThemeContext'

type Theme = 'light' | 'dark' | 'system'
export type IThemeContext = ReturnType<typeof useInitialState>

const useInitialState = () => {
    const config = useAuroraConfig()

    const [theme, setTheme] = useState<Theme>(() => {
        const savedTheme = localStorage.getItem('theme') as Theme
        return savedTheme || 'light'
    })

    const [themeId, setThemeId] = useState<string>(() => {
        const saved = localStorage.getItem('themeId')
        return saved || config.defaultTheme || 'aurora'
    })

    const [themes, setThemes] = useState<ThemeDefinition[]>(() => THEMES)

    // Themes can also come from the server (admin can extend the catalog later)
    useEffect(() => {
        const merged = THEMES.map(theme => {
            if (theme.id !== config.defaultTheme || !config.themeVars) return theme
            return { ...theme, light: { ...theme.light, ...config.themeVars.light }, dark: { ...theme.dark, ...config.themeVars.dark } }
        })
        setThemes(merged)
        if (!localStorage.getItem('themeId')) setThemeId(config.defaultTheme || 'aurora')
    }, [config.defaultTheme, config.themeVars])

    useEffect(() => {
        const html = document.documentElement
        const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)')

        const resolve = (currentTheme: Theme) =>
            currentTheme === 'system' ? (systemDarkQuery.matches ? 'dark' : 'light') : currentTheme

        html.classList.remove('light', 'dark')
        html.classList.add(resolve(theme))

        const handleSystemChange = (e: MediaQueryListEvent) => {
            if (theme === 'system') {
                html.classList.remove('light', 'dark')
                html.classList.add(e.matches ? 'dark' : 'light')
                applyThemeVars(getTheme(themeId, themes).dark, getTheme(themeId, themes).light)
            }
        }
        systemDarkQuery.addEventListener('change', handleSystemChange)
        return () => systemDarkQuery.removeEventListener('change', handleSystemChange)
    }, [theme, themeId, themes])

    const toggleTheme = (newTheme: Theme) => {
        setTheme(newTheme)
        const html = document.documentElement
        setTimeout(() => {
            html.classList.remove('light', 'dark')
            if (newTheme === 'system') {
                html.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            } else {
                html.classList.add(newTheme)
            }
            localStorage.setItem('theme', newTheme)
        }, 200) // Delayed class switch
    }

    const setThemeById = (id: string) => {
        setThemeId(id)
        localStorage.setItem('themeId', id)
    }

    return { theme, toggleTheme, themeId, setThemeById, themes }
}

export const ThemeContextProvider = ({ children }: { children: ReactNode }) => {
    const initialState = useInitialState()
    return <ThemeContext.Provider value={initialState}>{children}</ThemeContext.Provider>
}
