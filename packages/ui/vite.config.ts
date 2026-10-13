import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@hydra/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
      '@hydra/secure-channel': fileURLToPath(new URL('../secure-channel/src/index.ts', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // No inline scripts: the engine serves the UI with a strict Content-Security-Policy.
    modulePreload: { polyfill: false }
  },
  server: { port: 5180, strictPort: true }
})
