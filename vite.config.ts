import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // backend: docker compose --profile app up (infra) → 127.0.0.1:48000
    proxy: { '/api': 'http://127.0.0.1:48000' },
  },
})
