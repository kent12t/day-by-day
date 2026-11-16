import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const THEME_COLOR = '#090c1a';

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  server: {
    port: 3000,
  },
  plugins: [
    // Installable PWA + offline (issue #8). generateSW precaches the whole build output: app shell, JS/CSS
    // (including the atlas paint-worker chunk), the prompt library, icons and the self-hosted fonts.
    // No runtime caching is configured, so nothing cross-origin is ever cached (the app makes no such requests).
    // autoUpdate: a new deploy's service worker takes over silently and its files are used from the next
    // launch; the page is never reloaded under someone mid-reflection.
    VitePWA({
      registerType: 'autoUpdate',
      includeManifestIcons: false, // already matched by globPatterns below
      injectRegister: 'script',
      manifest: {
        id: '/',
        name: 'Day by Day',
        short_name: 'Day by Day',
        description: 'A moonlit journaling atlas for quiet daily reflection. Private, local-first, works offline.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        categories: ['lifestyle', 'health', 'productivity'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/moon-atlas-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [
          {
            name: 'Reflect',
            short_name: 'Reflect',
            description: "Open today's reflection prompt",
            url: '/?view=reflect',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Memories',
            short_name: 'Memories',
            description: 'Browse your past reflections',
            url: '/?view=memories',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{html,js,css,json,png,svg,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
});
