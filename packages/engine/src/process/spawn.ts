import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join } from 'node:path'

const IS_WINDOWS = process.platform === 'win32'

/** Characters that cmd.exe would interpret. Arguments routed through cmd.exe must not contain them. */
const CMD_UNSAFE = /[&|<>^%!"`\r\n]/

export function isWindowsShim(path: string): boolean {
  return IS_WINDOWS && /^\.(cmd|bat)$/i.test(extname(path))
}

/**
 * Finds an executable on PATH (honouring PATHEXT on Windows). Native executables
 * are preferred over .cmd/.bat shims so that no shell is involved.
 */
export function findOnPath(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (isAbsolute(command)) return existsSync(command) ? command : null
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  const exts = IS_WINDOWS ? ['.exe', '.com', '.cmd', '.bat', ''] : ['']
  for (const ext of exts) {
    for (const dir of dirs) {
      const candidate = join(dir, command + ext)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch { /* not here */ }
    }
  }
  return null
}

/** Newest file matching `<base>/<any>/<file>`; used for versioned install layouts. */
export function newestInSubdirs(base: string, file: string): string | null {
  if (!existsSync(base)) return null
  const hits = readdirSync(base)
    .map((dir) => join(base, dir, file))
    .filter((path) => existsSync(path))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return hits[0] ?? null
}

export interface SafeSpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  stdin?: 'pipe' | 'ignore'
}

/**
 * Spawns argv without a shell. Windows .cmd/.bat shims can only run through cmd.exe;
 * in that case every argument must pass the allowlist, otherwise we refuse.
 */
export function spawnArgv(executable: string, args: readonly string[], options: SafeSpawnOptions): ChildProcess {
  const base: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    detached: !IS_WINDOWS, // own process group on POSIX so the whole tree can be signalled
    stdio: [options.stdin ?? 'ignore', 'pipe', 'pipe']
  }
  if (isWindowsShim(executable)) {
    for (const part of [executable, ...args]) {
      if (CMD_UNSAFE.test(part)) throw new Error(`Refusing to pass "${part}" through cmd.exe; install a native executable instead.`)
    }
    const quoted = [executable, ...args].map((part) => (/[\s()]/.test(part) ? `"${part}"` : part)).join(' ')
    const comspec = process.env.ComSpec ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
    return spawn(comspec, ['/d', '/s', '/c', `"${quoted}"`], { ...base, windowsVerbatimArguments: true })
  }
  return spawn(executable, [...args], base)
}

/** Terminates the process and all of its descendants. Resolves once the request completed. */
export async function killTree(child: ChildProcess, graceMs = 1500): Promise<void> {
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return
  if (IS_WINDOWS) {
    const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    await new Promise<void>((resolve) => {
      const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('close', () => resolve())
      killer.on('error', () => resolve())
    })
    return
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    // Hydra starts agents in their own process group; if this one has none, signal the process itself.
    try { process.kill(-pid, signal) } catch { try { child.kill(signal) } catch { /* already gone */ } }
  }
  signalGroup('SIGTERM')
  const exited = await waitForExit(child, graceMs)
  if (!exited) signalGroup('SIGKILL')
}

/**
 * After a process exits normally, kills anything left in its process group (POSIX).
 * Windows has no equivalent without Job Objects; orphaned descendants there are a
 * documented residual risk (THREAT_MODEL T16).
 */
export function reapGroup(child: ChildProcess): void {
  if (IS_WINDOWS || !child.pid) return
  try { process.kill(-child.pid, 'SIGKILL') } catch { /* group already empty */ }
}

export function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('close', () => { clearTimeout(timer); resolve(true) })
  })
}

/** Splits a byte stream into lines, tolerating CRLF and partial chunks. */
export function lineSplitter(onLine: (line: string) => void, maxLineBytes = 8 * 1024 * 1024) {
  let buffer = ''
  return {
    push(chunk: Buffer | string) {
      buffer += chunk.toString()
      if (buffer.length > maxLineBytes) {
        onLine(buffer.slice(0, maxLineBytes))
        buffer = ''
        return
      }
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, '')
        buffer = buffer.slice(index + 1)
        if (line) onLine(line)
      }
    },
    end() {
      const rest = buffer.replace(/\r$/, '')
      buffer = ''
      if (rest) onLine(rest)
    }
  }
}
