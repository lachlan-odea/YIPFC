import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Served from GitHub Pages at https://lachlan-odea.github.io/YIPFC/
const base = '/YIPFC/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // og.png is only for link previews, so it stays out of the offline precache.
      includeAssets: ['brand/favicon.png', 'brand/logo.png', 'brand/goblin.png', 'brand/wordmark-sm.png', 'icons/apple-touch-180.png'],
      manifest: {
        name: 'Yes I pay for cardboard',
        short_name: 'YIPFC',
        description: 'The shared pile of spare Commander cards your pod can borrow from each other.',
        theme_color: '#120b1d',
        background_color: '#120b1d',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/art-index.bin', '**/brand/og.png'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        runtimeCaching: [
          {
            // Art index for picture recognition (~3 MB): fetched on the first
            // scan, then served from cache; a new deploy's file replaces it.
            urlPattern: /\/art-index\.bin$/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'art-index', expiration: { maxEntries: 2 } },
          },
          {
            // Card images: cache first, they never change for a given printing.
            urlPattern: /^https:\/\/(cards|svgs)\.scryfall\.io\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'scryfall-images',
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Scryfall API: prefer fresh, fall back to cache when offline.
            urlPattern: /^https:\/\/api\.scryfall\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'scryfall-api',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Tesseract worker + English language data (a few MB, downloaded once).
            urlPattern: /^https:\/\/(cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com|unpkg\.com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ocr-assets',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
})
