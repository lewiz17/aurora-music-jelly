import { AuthForm } from '../components/AuthForm'
import { BrandLogo } from '../components/BrandLogo'
import { useAuroraConfig } from '../config/AuroraConfig'

export const Login = ({
    onLogin,
}: {
    onLogin: (authData: { serverUrl: string; token: string; userId: string; username: string }) => void
}) => {
    const config = useAuroraConfig()

    return (
        <div
            className="login"
            style={
                config.assets.loginBackground
                    ? { backgroundImage: `url(${config.assets.loginBackground})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : undefined
            }
        >
            <div className="login_header">
                <BrandLogo className="logo" />
            </div>
            <AuthForm onLogin={onLogin} />
            <div className="disclaimer">
                {config.brandName} · v{__VERSION__}
            </div>
        </div>
    )
}
