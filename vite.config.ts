import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const version = process.env.npm_package_version || 'unknown'
const base = process.env.URL_BASE_PATH || '/'

export default defineConfig({
    base,
    plugins: [
        react(),
        VitePWA({
            // Ask before reloading: never swap the service worker while music is playing
            registerType: 'prompt',
            // Registered by a guarded snippet in index.html: the plugin's inline script throws
            // in sandboxed preview iframes (serviceWorker access is blocked there).
            injectRegister: false,
            workbox: {
                globPatterns: ['**/*.{js,css,html,ico,svg}', 'web-app-manifest-*.png'],
                globIgnores: ['**/*-variant*.{webp,png}', '**/search-*.png', '**/docs/**'],
                cleanupOutdatedCaches: true,
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [/^\/api/, /^\/jf/, /^\/admin/, /^\/branding/],
                maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
                runtimeCaching: [
                    {
                        // Artwork and audio are per-user and authenticated: never cache them
                        urlPattern: /\/jf\/.*\/(Images|Audio)\//,
                        handler: 'NetworkOnly',
                    },
                ],
            },
            manifest: {
                name: 'Aurora Music',
                short_name: 'Aurora',
                description: 'Tu música, en un solo lugar.',
                lang: 'es',
                start_url: base,
                scope: base,
                display: 'standalone',
                orientation: 'portrait',
                theme_color: '#7b5cff',
                background_color: '#0b0a12',
                icons: [
                    { src: './web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                    { src: './web-app-manifest-256x256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
                    { src: './web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                    {
                        src: './web-app-manifest-otherOS-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },
        }),
        {
            name: 'html-version-injector',
            // `crossorigin` on the generated <script>/<link> tags forces a CORS check, which
            // fails inside sandboxed preview iframes (they send `Origin: null`). Everything is
            // served from the same origin, so the attribute is not needed here.
            transformIndexHtml: {
                order: 'post',
                handler(html) {
                    return html.replace('__VERSION__', version).replace(/\scrossorigin(?:=("|')[^"']*\1)?/g, '')
                },
            },
        },
    ],
    build: {
        target: 'es2020',
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return
                    if (id.includes('hls.js')) return 'hls'
                    if (id.includes('m3u8-parser')) return 'm3u8'
                    if (id.includes('@jellyfin/sdk')) return 'jellyfin-sdk'
                    if (id.includes('@dnd-kit')) return 'dnd-kit'
                    if (id.includes('react-router')) return 'router'
                    if (id.includes('@tanstack')) return 'tanstack'
                    if (id.includes('react-dom') || id.includes('/react/')) return 'react'
                    return 'vendor'
                },
            },
        },
    },
    define: {
        __NPM_LIFECYCLE_EVENT__: JSON.stringify(process.env.npm_lifecycle_event),
        __VERSION__: JSON.stringify(version),
    },
})
