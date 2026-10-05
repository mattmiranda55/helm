import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// The Bun server owns /api and /pty in every environment; in dev, Vite just
// forwards to it so the frontend never needs an environment switch.
const API_TARGET = process.env.HELM_SERVER ?? 'http://127.0.0.1:3001'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/pty': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
})
