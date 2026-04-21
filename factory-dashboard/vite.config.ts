import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['dev-hub.agentryx.dev'],
    proxy: {
      '/api': {
        target: 'http://localhost:4400',
        changeOrigin: true,
      },
      '/telemetry': {
        target: 'http://localhost:4401',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/telemetry/, '/api')
      },
    },
  },
})
