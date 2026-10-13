import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from 'child_process'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'

/** Resolve a real executable, never feed user data to a Windows command shell. */
export function resolveCliExecutable(command: string): string | null {
  if (process.platform === 'win32') {
    const npm = process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules')
    if (npm && command === 'claude') {
      const native = join(npm, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
      if (existsSync(native)) return native
    }
    if (command === 'codex') {
      const base = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin')
      if (base && existsSync(base)) {
        const binaries = readdirSync(base).map(v => join(base, v, 'codex.exe')).filter(existsSync)
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
        if (binaries[0]) return binaries[0]
      }
      if (npm) {
        for (const baseDir of [join(npm, '@openai', 'codex', 'node_modules', '@openai'), join(npm, '@openai')]) {
          const native = join(baseDir, `codex-win32-${process.arch}`, 'vendor', `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, 'codex', 'codex.exe')
          if (existsSync(native)) return native
        }
      }
    }
  }
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [command], { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      .split(/\r?\n/).map(v => v.trim()).filter(Boolean)
    return found.find(v => process.platform !== 'win32' || /\.exe$/i.test(v)) ?? null
  } catch { return null }
}

export function spawnResolvedCli(command: string, args: string[], options: SpawnOptions = {}) {
  const executable = resolveCliExecutable(command)
  if (!executable) throw new Error(`${command} CLI unavailable: a directly executable installation is required`)
  return spawn(executable, args, { ...options, shell: false, windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, ...options.env, FORCE_COLOR: '0', ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } })
}

/** Cancellation resolves only after the tree termination request succeeds. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  if (process.platform === 'win32') {
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe')
    await new Promise<void>((resolve, reject) => {
      const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false })
      killer.on('error', reject)
      killer.on('close', code => code === 0 ? resolve() : reject(new Error(`Process tree cancellation failed (${code})`)))
    })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    const pid = child.pid
    // The direct child can close while a descendant keeps the process group alive.
    await new Promise<void>(resolve => setTimeout(resolve, 2000))
    try { process.kill(-pid, 'SIGKILL') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  }
}

export function cliHelp(command: string): string {
  const executable = resolveCliExecutable(command)
  if (!executable) throw new Error(`${command} CLI unavailable`)
  return execFileSync(executable, ['--help'], { encoding: 'utf8', timeout: 10000, windowsHide: true, cwd: dirname(executable) })
}

/** Keep authentication and deny rules, but remove ambient external tools for task runs. */
export function codexTaskIsolationArgs(): string[] {
  const args = ['--disable', 'apps', '--disable', 'plugins', '--disable', 'hooks', '--disable', 'multi_agent']
  const config = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml')
  try {
    const text = readFileSync(config, 'utf8')
    const names = new Set<string>()
    for (const match of text.matchAll(/^\s*\[mcp_servers\.([A-Za-z0-9_-]+|"[^"\r\n]+")\]\s*$/gm)) names.add(match[1])
    for (const name of names) args.push('-c', `mcp_servers.${name}.enabled=false`)
  } catch { /* No user config: explicit sandbox and feature controls still apply. */ }
  return args
}
