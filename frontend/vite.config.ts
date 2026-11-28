import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // No update prompt UI exists, so new versions must activate on their own;
      // otherwise returning users stay on the old cached build.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Samvad — Medical Interpreter',
        short_name: 'Samvad',
        description: 'Voice-first two-way medical interpreter for Indian clinics.',
        theme_color: '#0066cc',
        background_color: '#f5f5f7',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // App shell only. Never cache API responses or audio: patient data must
        // not linger in a service-worker cache (Critical Rule 3).
        // Fonts are runtime-cached on first use (23 scripts would bloat precache).
        globPatterns: ['**/*.{js,css,html,svg}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'font',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 120, maxAgeSeconds: 31536000 } },
          },
        ],
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Local dev: the FastAPI backend (backend/, uvicorn on :8000) serves /api,
  // including the live-transcription WebSocket. In production Caddy does this.
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', ws: true, changeOrigin: true },
    },
  },
  // Pre-bundle these on startup so the dev server never discovers it mid-session
  // (that leaves a stale dep cache: 504 "Outdated Optimize Dep" and a blank page).
  optimizeDeps: {
    include: ['motion/react', 'voice-glow', '@floating-ui/dom', 'clsx', 'tailwind-merge', '@supabase/supabase-js'],
  },
})
