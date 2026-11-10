import React, { ErrorInfo, ReactNode } from 'react'
import { persister, queryClient } from '../queryClient'
import { createTranslator } from '../i18n/i18n'
import './ErrorBoundary.css'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
    showDetails: boolean
}

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = {
        hasError: false,
        error: null,
        showDetails: false,
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(error, info)
    }

    toggleDetails = () => {
        this.setState(({ showDetails }) => ({ showDetails: !showDetails }))
    }

    reloadPage = async () => {
        queryClient.clear()
        await persister.removeClient()

        if (navigator.onLine) {
            const registrations = await navigator.serviceWorker?.getRegistrations?.().catch(() => [])
            await Promise.all((registrations || []).map(r => r.unregister()))
            await Promise.all(((await window.caches?.keys()) || []).map(c => window.caches.delete(c)))
        }

        window.location.reload()
    }

    render() {
        const translate = createTranslator((localStorage.getItem('language') as 'es' | 'en') || 'es')
        const { hasError, error, showDetails } = this.state

        if (hasError) {
            return (
                <div className="error-page">
                    <div className="error_header">
                        <div className="logo gradient-logo" role="img" aria-label="Aurora"></div>
                    </div>
                    <div className="error-content">
                        <div className="container">
                            <div className="title">{translate('common.somethingWrong')}</div>
                            <div className="description">{translate('error.desc')}</div>
                            <div className="error-actions noSelect">
                                <button onClick={this.toggleDetails} className="btn-details">
                                    {showDetails ? translate('error.hide') : translate('error.show')}
                                </button>
                                <button onClick={this.reloadPage} className="btn-reload">
                                    {translate('error.clear')}
                                </button>
                            </div>
                        </div>
                        <pre className={`error-details ${showDetails && error ? 'visible' : 'hidden'}`}>
                            {error?.stack || error?.toString()}
                        </pre>
                    </div>
                    <div className="disclaimer">{translate('common.appName')} - v{__VERSION__}</div>
                </div>
            )
        }

        return this.props.children
    }
}
