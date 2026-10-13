import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const electronVite = fileURLToPath(
  new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url),
)
const child = spawn(process.execPath, [electronVite, 'dev'], {
  env,
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
