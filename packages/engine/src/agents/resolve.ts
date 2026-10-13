import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findOnPath, isWindowsShim, newestInSubdirs, spawnArgv } from '../process/spawn.js'

/** Well-known install locations, checked before PATH so native binaries win over shims. */
export function resolveProviderExecutable(provider: 'claude' | 'codex', env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env[`HYDRA_${provider.toUpperCase()}_PATH`]
  if (override && existsSync(override)) return override
  const candidates: Array<string | null> = []
  if (process.platform === 'win32') {
    const appData = env.APPDATA
    const localAppData = env.LOCALAPPDATA
    if (provider === 'claude') {
      if (appData) candidates.push(join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
      candidates.push(join(homedir(), '.local', 'bin', 'claude.exe'))
    } else {
      if (localAppData) candidates.push(newestInSubdirs(join(localAppData, 'OpenAI', 'Codex', 'bin'), 'codex.exe'))
      if (appData) {
        const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
        candidates.push(join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', `${arch}-pc-windows-msvc`, 'codex', 'codex.exe'))
      }
    }
  } else {
    candidates.push(join(homedir(), '.local', 'bin', provider))
    if (provider === 'claude') candidates.push(join(homedir(), '.claude', 'local', 'claude'))
  }
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate
  return findOnPath(provider, env)
}

/** Runs `<exe> <args>` without a shell and returns stdout (empty string on failure). */
export function captureOutput(executable: string, args: string[], options: { timeoutMs?: number; includeStderr?: boolean } = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 15_000
  if (isWindowsShim(executable)) {
    return new Promise((resolve) => {
      let out = ''
      try {
        const child = spawnArgv(executable, args, { cwd: homedir(), env: process.env })
        const timer = setTimeout(() => child.kill(), timeoutMs)
        child.stdout?.on('data', (chunk) => { out += chunk.toString() })
        if (options.includeStderr) child.stderr?.on('data', (chunk) => { out += chunk.toString() })
        child.on('close', () => { clearTimeout(timer); resolve(out) })
        child.on('error', () => { clearTimeout(timer); resolve('') })
      } catch { resolve('') }
    })
  }
  return new Promise((resolve) => {
    execFile(executable, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const out = String(stdout) + (options.includeStderr ? String(stderr) : '')
      resolve(error && !out ? '' : out)
    })
  })
}
