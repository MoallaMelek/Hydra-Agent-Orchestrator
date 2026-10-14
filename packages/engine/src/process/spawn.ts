import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import { ProcessJob } from './winjob.js'

const IS_WINDOWS = process.platform === 'win32'

/** Windows: the job object holding each child's whole process tree (see winjob.ts). */
const jobs = new WeakMap<ChildProcess, ProcessJob>()

/** Puts a freshly started child in its own job (Windows); its descendants inherit it. */
function contain(child: ChildProcess): ChildProcess {
  if (!IS_WINDOWS || !child.pid) return child
  const job = ProcessJob.adopt(child.pid)
  if (job) {
    jobs.set(child, job)
    // When the child ends, anything it left behind ends too; then release the job.
    child.once('close', () => { job.terminate(); job.close() })
  }
  return child
}

/** True when this child's tree is held by an OS job object (Windows). */
export function isContained(child: ChildProcess): boolean {
  return jobs.has(child)
}

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
    return contain(spawn(comspec, ['/d', '/s', '/c', `"${quoted}"`], { ...base, windowsVerbatimArguments: true }))
  }
  return contain(spawn(executable, [...args], base))
}

/**
 * Terminates the process and all of its descendants. Resolves true once nothing is left
 * running, false if something may have survived (the caller must report it).
 */
export async function killTree(child: ChildProcess, graceMs = 1500): Promise<boolean> {
  const pid = child.pid
  const job = jobs.get(child)
  if (job) {
    // A descendant started in the instant before the child entered its job is outside it:
    // end the live tree by parentage first, then everything in the job (OS-enforced).
    if (pid && child.exitCode === null && child.signalCode === null) await taskkillTree(pid)
    job.terminate()
    const emptied = await job.waitEmpty(5000)
    return emptied && await waitForExit(child, graceMs)
  }
  if (!pid) return true
  const exited = child.exitCode !== null || child.signalCode !== null
  if (IS_WINDOWS) {
    if (!exited) await taskkillTree(pid)
    return waitForExit(child, graceMs)
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    // Hydra starts agents in their own process group; if this one has none, signal the process itself.
    try { process.kill(-pid, signal) } catch { try { child.kill(signal) } catch { /* already gone */ } }
  }
  // Success means the whole group is gone, not only the parent: descendants may ignore SIGTERM
  // or outlive a parent that already exited.
  if (!exited) {
    signalGroup('SIGTERM')
    if (await waitForExit(child, graceMs) && await groupGone(pid, 200)) return true
  } else if (!groupAlive(pid)) return true
  signalGroup('SIGKILL')
  return await waitForExit(child, graceMs) && await groupGone(pid, graceMs)
}

/** Windows: ends a live process and its descendants by parentage. */
function taskkillTree(pid: number): Promise<void> {
  const taskkill = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
  return new Promise<void>((resolve) => {
    const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.on('close', () => resolve())
    killer.on('error', () => resolve())
  })
}

/** POSIX: true while any process of the group led by `pid` exists (or cannot be checked). */
function groupAlive(pid: number | undefined): boolean {
  if (!pid) return false
  try { process.kill(-pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

async function groupGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (groupAlive(pid)) {
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 25))
  }
  return true
}

/**
 * After a process exits normally, kills anything it left behind: its job object on
 * Windows, its process group on POSIX (THREAT_MODEL T16).
 */
export function reapGroup(child: ChildProcess): void {
  const job = jobs.get(child)
  if (job) { job.terminate(); return }
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
