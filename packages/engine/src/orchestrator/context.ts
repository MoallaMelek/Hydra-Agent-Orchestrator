import { join } from 'node:path'
import type { Task } from '@hydra/protocol'
import type { AdapterRegistry } from '../agents/registry.js'
import type { WorkspaceManager } from '../isolation/workspace.js'
import type { Store } from '../store/store.js'
import { notFound } from '../util/errors.js'

export interface EnginePaths {
  dataDir: string
  database: string
  worktrees: string
  checkouts: string
  logs: string
  scratch: string
  backups: string
}

export function enginePaths(dataDir: string): EnginePaths {
  return {
    dataDir,
    database: join(dataDir, 'hydra.db'),
    worktrees: join(dataDir, 'worktrees'),
    checkouts: join(dataDir, 'checkouts'),
    logs: join(dataDir, 'logs'),
    scratch: join(dataDir, 'scratch'),
    backups: join(dataDir, 'backups')
  }
}

/** Counting semaphore limiting concurrent agent processes across all tasks. */
export class Semaphore {
  private active = 0
  private readonly waiting: Array<() => void> = []
  constructor(readonly limit: number) {}

  async acquire(signal: AbortSignal): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          const index = this.waiting.indexOf(go)
          if (index >= 0) this.waiting.splice(index, 1)
          reject(new Error('Canceled while waiting for a free agent slot'))
        }
        const go = () => { signal.removeEventListener('abort', onAbort); resolve() }
        this.waiting.push(go)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
    this.active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.waiting.shift()?.()
    }
  }
}

export interface EngineContext {
  runtimeVersion?: string
  store: Store
  registry: AdapterRegistry
  workspaces: WorkspaceManager
  paths: EnginePaths
  agentSlots: Semaphore
  env: NodeJS.ProcessEnv
}

/** Reads the freshest task, applies a synchronous mutation and persists it (one event-loop turn: atomic). */
export function updateTask(ctx: EngineContext, taskId: string, mutate: (task: Task) => Task | void): Task {
  const current = ctx.store.getTask(taskId)
  if (!current) throw notFound('Task')
  const draft = structuredClone(current)
  const result = mutate(draft) ?? draft
  return ctx.store.putTask(result)
}

export function logTask(ctx: EngineContext, taskId: string, level: 'info' | 'warn' | 'error', message: string): void {
  ctx.store.publish({ type: 'task.log', taskId, level, message: message.slice(0, 4000) })
}
