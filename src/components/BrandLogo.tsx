import { useEffect, useState } from 'react'
import { useAuroraConfig } from '../config/AuroraConfig'

/**
 * Brand mark. Uses the uploaded logo when it loads, and falls back to the
 * gradient mark otherwise (missing file, broken upload, offline…).
 */
export const BrandLogo = ({
    className = '',
    style,
    dark,
}: {
    className?: string
    style?: React.CSSProperties
    dark?: boolean
}) => {
    const config = useAuroraConfig()
    const candidate = (dark ? config.assets.logoDark || config.assets.logo : config.assets.logo) || null
    const [valid, setValid] = useState<boolean | null>(null)

    useEffect(() => {
        if (!candidate) return setValid(false)
        let cancelled = false
        const image = new Image()
        image.onload = () => !cancelled && setValid(image.naturalWidth > 0)
        image.onerror = () => !cancelled && setValid(false)
        image.src = candidate
        return () => {
            cancelled = true
        }
    }, [candidate])

    const useImage = Boolean(candidate) && valid !== false

    return (
        <div
            className={`${className} ${useImage ? 'custom-logo' : 'gradient-logo'}`}
            style={useImage ? { backgroundImage: `url(${candidate})`, ...style } : style}
            role="img"
            aria-label={config.brandName}
        />
    )
}
