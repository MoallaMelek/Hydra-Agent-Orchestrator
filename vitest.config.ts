import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (pkg: string) => fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@hydra/protocol': src('protocol'),
      '@hydra/engine': src('engine'),
      '@hydra/secure-channel': src('secure-channel')
    }
  },
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}', 'tools/**/*.test.mjs'],
    exclude: ['**/node_modules/**', 'legacy/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks'
  }
})
