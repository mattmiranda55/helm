import vue from '@vitejs/plugin-vue'
import path from 'path'
import { defineConfig } from 'vite'

// The Bun server owns /api and /pty in every environment; in dev, Vite just
// forwards to it so the frontend never needs an environment switch.
const API_TARGET = process.env.HELM_SERVER ?? 'http://127.0.0.1:3001'

// changeOrigin rewrites Host to the server's, so the server can no longer see
// that the page's Origin is this dev server. Tell it which host the browser
// used; it accepts WebSockets and mutations whose Origin names that host
// (server/index.ts, originAllowed). A web page can't set this header itself.
const forwardHost = (proxy: any) => {
  const stamp = (proxyReq: any, req: any) => proxyReq.setHeader('x-forwarded-host', req.headers.host ?? '')
  proxy.on('proxyReq', stamp)
  proxy.on('proxyReqWs', stamp)
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': { target: API_TARGET, ws: true, changeOrigin: true, configure: forwardHost },
      '/pty': { target: API_TARGET, ws: true, changeOrigin: true, configure: forwardHost },
    },
  }
})
