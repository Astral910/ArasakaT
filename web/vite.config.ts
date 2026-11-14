import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const target = process.env.VITE_API_TARGET || 'http://127.0.0.1:8200'

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5201,
    strictPort: true,
    proxy: { '/api': { target, changeOrigin: true }, '/webhook': { target, changeOrigin: true } },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('maplibre-gl')) return 'maplibre'
          if (id.includes('gsap')) return 'gsap'
        },
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
} as any)
