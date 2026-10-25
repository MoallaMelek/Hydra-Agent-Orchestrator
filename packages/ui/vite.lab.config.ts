import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

/** Interface lab (simulated fixtures): built separately, never part of the shipped UI. */
export default mergeConfig(base, defineConfig({
  build: { outDir: '.lab-dist', emptyOutDir: true, sourcemap: false, rollupOptions: { input: fileURLToPath(new URL('./lab.html', import.meta.url)) } },
  preview: { port: 5181, strictPort: true }
}))
