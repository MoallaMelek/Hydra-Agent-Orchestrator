import { useSyncExternalStore } from 'react'
import type { Device, EngineSnapshot, EventEnvelope, Project, ProviderStatus, Task } from '@hydra/protocol'
import type { ConnectionStatus, Transport } from './transport'

export interface LogLine { at: string; level: 'info' | 'warn' | 'error'; message: string }

export interface AppState {
  ready: boolean
  error: string | null
  connection: ConnectionStatus
  engineVersion: string
  projects: Project[]
  tasks: Record<string, Task>
  providers: ProviderStatus[]
  devices: Device[]
  /** Remote-control listener status, including the addresses a phone could use. */
  remote: EngineSnapshot['remote'] | null
  /** Live agent output per run (bounded). */
  output: Record<string, string>
  logs: Record<string, LogLine[]>
  /** Bumped when evidence or runs change for a task, so detail views refetch. */
  revision: Record<string, number>
}

const initial: AppState = {
  ready: false, error: null, connection: 'connecting', engineVersion: '', projects: [], tasks: {}, providers: [], devices: [], remote: null, output: {}, logs: {}, revision: {}
}

/** Minimal observable store: the engine's event stream is the only writer. */
export class EngineStore {
  private state: AppState = initial
  private readonly listeners = new Set<() => void>()
  private stop: (() => void) | null = null

  constructor(readonly transport: Transport) {}

  get = (): AppState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  async start(): Promise<void> {
    try {
      const snapshot = await this.transport.snapshot()
      this.load(snapshot)
      this.stop = this.transport.stream(snapshot.lastSeq, (envelope) => this.apply(envelope), (connection) => {
        this.set({ connection })
        if (connection === 'live' && this.state.ready) void this.transport.snapshot().then((s) => this.load(s)).catch(() => {})
      })
    } catch (error) {
      this.set({ error: (error as Error).message, connection: 'offline' })
    }
  }

  dispose(): void {
    this.stop?.()
  }

  private load(snapshot: EngineSnapshot): void {
    this.set({
      ready: true, error: null, engineVersion: snapshot.engineVersion, projects: snapshot.projects,
      tasks: Object.fromEntries(snapshot.tasks.map((t) => [t.id, t])), providers: snapshot.providers, devices: snapshot.devices, remote: snapshot.remote
    })
  }

  private bump(taskId: string): Record<string, number> {
    return { ...this.state.revision, [taskId]: (this.state.revision[taskId] ?? 0) + 1 }
  }

  private apply({ at, event }: EventEnvelope): void {
    switch (event.type) {
      case 'task.updated': return this.set({ tasks: { ...this.state.tasks, [event.task.id]: event.task } })
      case 'task.deleted': {
        const { [event.taskId]: _removed, ...rest } = this.state.tasks
        return this.set({ tasks: rest })
      }
      case 'task.log': {
        const lines = [...(this.state.logs[event.taskId] ?? []), { at, level: event.level, message: event.message }].slice(-300)
        return this.set({ logs: { ...this.state.logs, [event.taskId]: lines } })
      }
      case 'run.output': {
        const text = ((this.state.output[event.runId] ?? '') + event.text).slice(-60_000)
        return this.set({ output: { ...this.state.output, [event.runId]: text } })
      }
      case 'run.updated': return this.set({ revision: this.bump(event.run.taskId) })
      case 'evidence.recorded': return this.set({ revision: this.bump(event.evidence.taskId) })
      case 'project.updated': return this.set({ projects: [...this.state.projects.filter((p) => p.id !== event.project.id), event.project] })
      case 'project.removed': return this.set({ projects: this.state.projects.filter((p) => p.id !== event.projectId) })
      case 'providers.updated': return this.set({ providers: event.providers })
      case 'device.updated': return this.set({ devices: [...this.state.devices.filter((d) => d.id !== event.device.id), event.device] })
    }
  }
}

export function useEngine(store: EngineStore): AppState {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
