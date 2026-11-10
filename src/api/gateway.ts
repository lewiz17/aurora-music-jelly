/**
 * Aurora gateway client.
 *
 * The browser never receives the real server URL nor a real access token:
 * it trades an access code + credentials for an opaque gateway token, and every
 * request (API, images, audio) goes through `/jf/<gatewayToken>/...`.
 */

export interface GatewayLogin {
    serverUrl: string
    token: string
    userId: string
    username: string
}

export class GatewayError extends Error {
    constructor(
        message: string,
        public status: number,
        public code?: string
    ) {
        super(message)
    }
}

const postJson = async (path: string, body: unknown) => {
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
    })
    const text = await response.text()
    let data: Record<string, unknown> | undefined
    try {
        data = text ? JSON.parse(text) : {}
    } catch {
        data = undefined
    }
    data ??= {}
    if (!response.ok) {
        throw new GatewayError(
            (data.message as string) || `HTTP ${response.status}`,
            response.status,
            data.error as string | undefined
        )
    }
    return data
}

export const loginWithCode = async (code: string, username: string, password: string): Promise<GatewayLogin> => {
    const data = await postJson('/api/login', { code, username, password })
    const token = data.token as string
    return {
        // Relative: every request is proxied by the same origin, no upstream visible
        serverUrl: `/jf/${token}`,
        token,
        userId: data.userId as string,
        username: data.username as string,
    }
}

// ---------------------------------------------------------------------------
// Demo mode (?demo=1): same app, backed by the public Jellyfin demo server.
// Only used when the gateway is not available (e.g. static preview).
// ---------------------------------------------------------------------------
const DEMO_SERVER = 'https://demo.jellyfin.org/stable'

export const loginDemo = async (): Promise<GatewayLogin> => {
    const response = await fetch(`${DEMO_SERVER}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
            Authorization: `MediaBrowser Client="Aurora", Device="Web", DeviceId="aurora-demo", Version="1.0.0"`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ Username: 'demo', Pw: '' }),
        signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) throw new GatewayError('Demo no disponible', response.status)
    const data = await response.json()
    return {
        serverUrl: DEMO_SERVER,
        token: data.AccessToken,
        userId: data.User.Id,
        username: data.User.Name,
    }
}
