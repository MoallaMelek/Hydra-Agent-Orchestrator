import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface DaemonLockData {
  pid: number
  socketPath: string
  startedAt: string
  authToken: string
}

export function readLockFile(lockPath: string): DaemonLockData | null {
  try {
    if (!existsSync(lockPath)) return null
    const raw = readFileSync(lockPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<DaemonLockData>
    if (!parsed.pid || !parsed.socketPath) return null
    const data: DaemonLockData = {
      pid: parsed.pid,
      socketPath: parsed.socketPath,
      startedAt: parsed.startedAt ?? '',
      authToken: typeof parsed.authToken === 'string' ? parsed.authToken : ''
    }

    // Check if PID is still alive
    try {
      process.kill(data.pid, 0)
      return data
    } catch {
      // PID is dead — stale lock file
      removeLockFile(lockPath)
      return null
    }
  } catch {
    return null
  }
}

export function writeLockFile(lockPath: string, data: DaemonLockData): void {
  const dir = dirname(lockPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(lockPath, JSON.stringify(data, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

export function removeLockFile(lockPath: string): void {
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath)
    }
  } catch {
    // Best-effort cleanup
  }
}
