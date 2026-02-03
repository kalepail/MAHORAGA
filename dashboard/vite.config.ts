import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.MAHORAGA_API_URL || `http://localhost:${process.env.WRANGLER_PORT || '8787'}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // In production, API_BASE will be the full worker URL
    // In development, it stays as '/api' and gets proxied
    'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || '/api'),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, '/agent'),
      },
    },
  },
})
