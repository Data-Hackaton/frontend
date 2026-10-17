import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['assets/forte-logo.svg', 'assets/forte-logo-white.svg', 'assets/open-sans-variable.woff2'],
    manifest: {
      name: 'Forte · Видеоаудит кассовых операций', short_name: 'Видеоаудит',
      description: 'Просмотр записей, аудит событий и разметка для обучения',
      theme_color: '#4a0221', background_color: '#f6f4f3', display: 'standalone', start_url: '/', scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      globIgnores: ['**/scene-fixture.svg'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/assets\/scene-fixture\.svg$/],
      runtimeCaching: [],
    },
  })],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    // backend: docker compose --profile app up (infra) → 127.0.0.1:48000
    proxy: { '/api': 'http://127.0.0.1:48000' },
  },
})
