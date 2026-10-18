import { hostname } from 'node:os'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unavailable } from '../util/errors.js'
import { DatabaseSync } from 'node:sqlite'

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
  private guard: DatabaseSync | null = null

  constructor(dataDir: string) {
    this.file = join(dataDir, 'engine.lock')
  }

  acquire(): void {
    // OS-held SQLite file locks serialize even corrupt/stale JSON-marker takeover.
    // The connection remains open and the transaction is held for this engine's life.
    const guard = new DatabaseSync(`${this.file}.lease`)
    try { guard.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE') }
    catch { guard.close(); throw unavailable('Another Hydra engine is already using this data directory (or acquiring it).') }
    this.guard = guard
    let owner: { pid?: number; host?: string } = {}
    try { owner = JSON.parse(readFileSync(this.file, 'utf8')) as typeof owner } catch { /* corrupt lock = stale */ }
    const sameHost = !owner.host || owner.host === hostname()
    if (owner.pid && owner.pid !== process.pid && sameHost && alive(owner.pid)) {
      guard.exec('ROLLBACK'); guard.close(); this.guard = null
      throw unavailable(`Another Hydra engine (pid ${owner.pid}) is already using this data directory.`)
    }
    try { writeFileSync(this.file, JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() })) }
    catch (error) { guard.exec('ROLLBACK'); guard.close(); this.guard = null; throw error }
    this.held = true
  }

  release(): void {
    if (!this.held) return
    try {
      const owner = JSON.parse(readFileSync(this.file, 'utf8')) as { pid?: number }
      if (owner.pid === process.pid) rmSync(this.file, { force: true })
    } catch { /* already gone */ }
    this.held = false
    this.guard?.exec('ROLLBACK'); this.guard?.close(); this.guard = null
  }
}

/**
 * Historical PIDs have no OS creation identity. Decline automatic termination:
 * PID/name checks alone can kill a different customer CLI session after PID reuse.
 * Live cancellation and Windows kill-on-close jobs still use owned process handles.
 */
export function killOrphanAgent(_pid: number): Promise<boolean> {
  return Promise.resolve(false)
}
