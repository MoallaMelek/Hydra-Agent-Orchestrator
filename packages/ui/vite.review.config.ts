import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

/** Recorded-fixture review harness: built separately, never part of the shipped UI. */
export default mergeConfig(base, defineConfig({
  build: { outDir: '.review-dist', emptyOutDir: true, sourcemap: false, rollupOptions: { input: fileURLToPath(new URL('./review.html', import.meta.url)) } }
}))
