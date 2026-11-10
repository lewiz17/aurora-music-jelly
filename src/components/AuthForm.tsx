import { FormEvent, useEffect, useState } from 'react'
import { GatewayError, loginDemo, loginWithCode } from '../api/gateway'
import { useAuroraConfig } from '../config/AuroraConfig'
import { useI18n } from '../i18n/i18n'
import { Loader } from './Loader'

interface AuthData {
    serverUrl: string
    token: string
    userId: string
    username: string
}

export const AuthForm = ({ onLogin }: { onLogin: (authData: AuthData) => void }) => {
    const config = useAuroraConfig()
    const { t } = useI18n()

    const queryParams = new URLSearchParams(window.location.search)
    const isDemo = queryParams.get('demo') === '1'

    const [code, setCode] = useState(() => localStorage.getItem('lastCode') || '')
    const [username, setUsername] = useState(() => localStorage.getItem('lastUsername') || '')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    // Prefill the code from links like /login?code=XXXX
    useEffect(() => {
        const fromUrl = queryParams.get('code')
        if (fromUrl) setCode(fromUrl.toUpperCase())
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        // Auto-enter demo mode: no code needed
        if (!isDemo) return
        let cancelled = false
        setLoading(true)
        loginDemo()
            .then(auth => {
                if (!cancelled) onLogin(auth)
            })
            .catch(() => {
                if (!cancelled) setError(t('login.error.unreachable'))
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDemo])

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')

        if (!code.trim() || !username.trim()) {
            setError(t('login.error.missing'))
            return
        }

        setLoading(true)
        try {
            if (isDemo) {
                onLogin(await loginDemo())
                return
            }
            const auth = await loginWithCode(code.trim(), username.trim(), password)
            localStorage.setItem('lastCode', code.trim().toUpperCase())
            localStorage.setItem('lastUsername', username.trim())
            onLogin(auth)
        } catch (err) {
            if (err instanceof GatewayError) {
                if (err.status === 401) setError(t('login.error.credentials'))
                else if (err.status === 404) setError(t('login.error.code'))
                else if (err.status === 502) setError(t('login.error.unreachable'))
                else setError(t('login.error.generic'))
            } else {
                setError(t('login.error.generic'))
            }
        } finally {
            setLoading(false)
        }
    }

    if (isDemo && loading) return <Loader />

    return (
        <form
            className="login_form"
            onSubmit={handleSubmit}
        >
            <div className="error_placeholder">{error && <div className="error">{error}</div>}</div>
            <div className="title">{t('login.title')}</div>

            <div className="input_container">
                <input
                    type="text"
                    placeholder={config.codeFieldPlaceholder}
                    aria-label={config.codeFieldLabel}
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    disabled={loading}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                />
            </div>
            <div className="input_container">
                <input
                    type="text"
                    placeholder={t('login.username')}
                    aria-label={t('login.username')}
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    disabled={loading}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                />
            </div>
            <div className="input_container">
                <input
                    type="password"
                    placeholder={t('login.password')}
                    aria-label={t('login.password')}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="current-password"
                />
            </div>
            <button
                className="submit_button noSelect"
                type="submit"
                onClick={event => {
                    event.preventDefault()
                    void handleSubmit(event)
                }}
                disabled={loading}
            >
                {loading ? t('login.loading') : t('login.submit')}
            </button>
        </form>
    )
}
