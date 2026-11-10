import { ReactNode, useCallback, useEffect, useState } from 'react'
import { useAuroraConfig } from '../config/AuroraConfig'
import { I18nContext, Language, createTranslator } from './i18n'

export const I18nProvider = ({ children }: { children: ReactNode }) => {
    const config = useAuroraConfig()

    const [language, setLanguageState] = useState<Language>(() => {
        const saved = localStorage.getItem('language') as Language | null
        if (saved === 'es' || saved === 'en') return saved
        return config.defaultLanguage || 'es'
    })

    useEffect(() => {
        if (!localStorage.getItem('language') && config.defaultLanguage) {
            setLanguageState(config.defaultLanguage)
        }
    }, [config.defaultLanguage])

    useEffect(() => {
        document.documentElement.lang = language
    }, [language])

    const setLanguage = useCallback((next: Language) => {
        localStorage.setItem('language', next)
        setLanguageState(next)
    }, [])

    const t = createTranslator(language)

    return <I18nContext.Provider value={{ language, setLanguage, t }}>{children}</I18nContext.Provider>
}
