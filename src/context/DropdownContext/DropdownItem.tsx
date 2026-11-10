import { useCallback, useState } from 'react'
import { InlineLoader } from '../../components/InlineLoader'

interface DropdownItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void | Promise<void>
    disabled?: boolean
}

export const DropdownItem = ({
    className = '',
    onClick,
    onMouseEnter,
    children,
    disabled = false,
    ...rest
}: DropdownItemProps) => {
    const [isLoading, setIsLoading] = useState(false)

    const handleClick = useCallback(
        async (e: React.MouseEvent<HTMLDivElement>) => {
            if (disabled || isLoading || !onClick) return

            setIsLoading(true)

            try {
                await onClick(e)
            } finally {
                setIsLoading(false)
            }
        },
        [disabled, isLoading, onClick]
    )

    const computedClassName = `dropdown-item${className ? ` ${className}` : ''}${disabled ? ' disabled' : ''}`

    return (
        <div className={computedClassName} onClick={handleClick} onMouseEnter={onMouseEnter} {...rest}>
            {children}
            {isLoading && <InlineLoader />}
        </div>
    )
}
