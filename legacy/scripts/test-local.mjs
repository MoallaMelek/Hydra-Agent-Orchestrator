// Equivalent Vitest configuration without native esbuild walking parent directories
// to bundle the config. Useful in restricted Windows filesystem environments.
import { startVitest } from 'vitest/node'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const context = await startVitest('test', process.argv.slice(2), { run: true, config: false }, {
  configFile: false,
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('shared'), '@': resolve('src') } },
  test: { globals: false, environment: 'node', setupFiles: ['./src/test-setup.ts'], include: ['electron/**/*.test.ts', 'src/**/*.test.{ts,tsx}'], fileParallelism: false }
})
if (context && (context.state.getFiles().some(file => file.result?.state === 'fail') || context.state.getUnhandledErrors().length)) process.exitCode = 1
await context?.close()
