import { execFile } from 'node:child_process'
import { hostname } from 'node:os'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unavailable } from '../util/errors.js'

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

/**
 * One engine owns a data directory at a time. A second engine would "recover"
 * tasks that are actually still running and race the live agents.
 */
export class InstanceLock {
  private readonly file: string
  private held = false

  constructor(dataDir: string) {
    this.file = join(dataDir, 'engine.lock')
  }

  acquire(): void {
    try {
      writeFileSync(this.file, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }), { flag: 'wx' })
      this.held = true
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    let owner: { pid?: number; host?: string } = {}
    try { owner = JSON.parse(readFileSync(this.file, 'utf8')) as typeof owner } catch { /* corrupt lock = stale */ }
    const sameHost = !owner.host || owner.host === hostname()
    if (owner.pid && owner.pid !== process.pid && sameHost && alive(owner.pid)) {
      throw unavailable(`Another Hydra engine (pid ${owner.pid}) is already using this data directory.`)
    }
    writeFileSync(this.file, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }))
    this.held = true
  }

  release(): void {
    if (!this.held) return
    try {
      const owner = JSON.parse(readFileSync(this.file, 'utf8')) as { pid?: number }
      if (owner.pid === process.pid) rmSync(this.file, { force: true })
    } catch { /* already gone */ }
    this.held = false
  }
}

function imageName(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
        const match = /^"([^"]+)"/m.exec(String(stdout))
        resolve(error || !match ? null : match[1]!)
      })
    } else {
      execFile('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : String(stdout).trim() || null))
    }
  })
}

/**
 * Terminates an agent process left over from a crashed engine, but only if the PID
 * still belongs to a provider CLI (PIDs are reused by the OS).
 */
export async function killOrphanAgent(pid: number): Promise<boolean> {
  if (!alive(pid)) return false
  const name = await imageName(pid)
  if (!name || !/(^|[\\/])(claude|codex)(\.exe)?$/i.test(name)) return false
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve()))
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
  }
  return true
}
