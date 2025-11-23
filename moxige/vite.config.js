import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT || 5173),
    strictPort: false,
    proxy: {
      // Dev-only proxy to backend API
      '/api': {
        target: 'http://127.0.0.1:5210',
        changeOrigin: true,
        secure: false,
      },
      // Dev-only proxy to bypass CORS for Yahoo Finance chart/quote endpoints
      // Usage in code: fetch('/yf/v8/finance/chart/^GSPC?...')
      '/yf': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/yf/, ''),
      },
    },
  },
  // Keep preview port consistent with dev server (5173)
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PREVIEW_PORT || 5176),
    strictPort: false,
  },
})
