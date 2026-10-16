import { useCallback, useRef, useSyncExternalStore } from 'react'
import { DURABLE_EVENT_TYPES, type AgentRunInfo, type Device, type EngineSnapshot, type EventEnvelope, type Evidence, type Project, type ProviderStatus, type RunActivity, type Task } from '@hydra/protocol'
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
  /** How many agent processes the engine runs at once, across all tasks. */
  agentSlots: number
  /** Agent runs seen so far (running ones from the snapshot, others from events and task details). */
  runs: Record<string, AgentRunInfo>
  /** Live tool calls per run, newest last (the run record's own list replaces it when the run ends). */
  activity: Record<string, RunActivity[]>
  /** Check results per task, for tasks whose detail was loaded or that ran checks while open. */
  evidence: Record<string, Evidence[]>
  /** Tasks whose runs and evidence have been loaded from the engine. */
  loaded: Record<string, true>
  /** Live agent output per run (bounded). */
  output: Record<string, string>
  /** A reply being written right now, per task (streamed answer text). */
  drafts: Record<string, string>
  logs: Record<string, LogLine[]>
}

const initial: AppState = {
  ready: false, error: null, connection: 'connecting', engineVersion: '', projects: [], tasks: {}, providers: [], devices: [], remote: null,
  agentSlots: 3, runs: {}, activity: {}, evidence: {}, loaded: {}, output: {}, drafts: {}, logs: {}
}

/** Memory bounds: the interface must stay small however long Hydra runs. */
export const LIMITS = { outputChars: 60_000, draftChars: 60_000, activityPerRun: 200, logLines: 300, runs: 500, outputRuns: 60 } as const

const TERMINAL = new Set<AgentRunInfo['status']>(['succeeded', 'failed', 'canceled', 'interrupted'])

/**
 * Observable store fed only by the engine. Events are applied as they arrive; listeners
 * are told at most once per animation frame, so a burst of events costs one render.
 * Components subscribe to slices (useEngine with a selector) and re-render only when
 * their slice changes.
 */
export class EngineStore {
  private state: AppState = initial
  private readonly listeners = new Set<() => void>()
  private stop: (() => void) | null = null
  private pending = false
  private lastSeq = 0
  private readonly loading = new Map<string, Promise<void>>()

  constructor(readonly transport: Transport) {}

  get = (): AppState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch }
    this.schedule()
  }

  /** One notification per frame; a timer stands in where frames do not run (tests, hidden windows). */
  private schedule(): void {
    if (this.pending) return
    this.pending = true
    const flush = () => {
      if (!this.pending) return
      this.pending = false
      for (const listener of this.listeners) listener()
    }
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      requestAnimationFrame(flush)
      setTimeout(flush, 100) // a frame that never comes (window hidden meanwhile) must not stall the state
    } else setTimeout(flush, 16)
  }

  /** Reloads the engine snapshot (for state that has no live event, such as phone access). */
  async reload(): Promise<void> {
    this.load(await this.transport.snapshot())
  }

  async start(): Promise<void> {
    try {
      const snapshot = await this.transport.snapshot()
      this.load(snapshot)
      this.stop = this.transport.stream(snapshot.lastSeq, (envelope) => this.apply(envelope), (connection) => {
        this.set({ connection })
        if (connection === 'live' && this.state.ready) {
          // After a reconnect: refresh state and the details already on screen.
          void this.transport.snapshot().then((s) => this.load(s)).catch(() => {})
          for (const taskId of Object.keys(this.state.loaded)) void this.loadTask(taskId, true)
        }
      })
    } catch (error) {
      this.set({ error: (error as Error).message, connection: 'offline' })
    }
  }

  dispose(): void {
    this.stop?.()
  }

  private load(snapshot: EngineSnapshot): void {
    this.lastSeq = Math.max(this.lastSeq, snapshot.lastSeq)
    const runs = { ...this.state.runs }
    for (const run of snapshot.activeRuns ?? []) runs[run.id] = mergeRun(runs[run.id], run)
    this.set({
      ready: true, error: null, engineVersion: snapshot.engineVersion, projects: snapshot.projects,
      tasks: Object.fromEntries(snapshot.tasks.map((t) => [t.id, t])), providers: snapshot.providers, devices: snapshot.devices, remote: snapshot.remote,
      agentSlots: snapshot.agentSlots ?? 3, runs
    })
  }

  /** Loads a task's runs and evidence once; later changes arrive as events. */
  loadTask(taskId: string, force = false): Promise<void> {
    if (!force && this.state.loaded[taskId]) return Promise.resolve()
    const existing = this.loading.get(taskId)
    if (existing) return existing
    const promise = this.transport.taskDetail(taskId).then((detail) => {
      const runs = { ...this.state.runs }
      for (const run of detail.runs) runs[run.id] = mergeRun(runs[run.id], run)
      const known = new Map((this.state.evidence[taskId] ?? []).map((e) => [e.id, e]))
      for (const e of detail.evidence) known.set(e.id, e)
      this.set({
        runs: pruneRuns(runs),
        evidence: { ...this.state.evidence, [taskId]: [...known.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)) },
        loaded: { ...this.state.loaded, [taskId]: true },
        tasks: this.state.tasks[taskId] && detail.task.updatedAt < this.state.tasks[taskId].updatedAt ? this.state.tasks : { ...this.state.tasks, [taskId]: detail.task }
      })
    }).catch(() => {}).finally(() => this.loading.delete(taskId))
    this.loading.set(taskId, promise)
    return promise
  }

  private apply({ seq, at, event }: EventEnvelope): void {
    // Durable events can repeat after a reconnect (the stream resumes from a cursor): apply each once.
    if (DURABLE_EVENT_TYPES.has(event.type)) {
      if (seq > 0 && seq <= this.lastSeq) return
      this.lastSeq = Math.max(this.lastSeq, seq)
    }
    switch (event.type) {
      case 'task.updated': {
        const current = this.state.tasks[event.task.id]
        if (current && event.task.updatedAt < current.updatedAt) return // out of order: keep the newer state
        return this.set({ tasks: { ...this.state.tasks, [event.task.id]: event.task } })
      }
      case 'task.deleted': {
        const { [event.taskId]: _removed, ...rest } = this.state.tasks
        return this.set({ tasks: rest })
      }
      case 'task.log': {
        const lines = [...(this.state.logs[event.taskId] ?? []), { at, level: event.level, message: event.message }].slice(-LIMITS.logLines)
        return this.set({ logs: { ...this.state.logs, [event.taskId]: lines } })
      }
      case 'run.output': {
        if (event.stream === 'answer') {
          const draft = ((this.state.drafts[event.taskId] ?? '') + event.text).slice(-LIMITS.draftChars)
          return this.set({ drafts: { ...this.state.drafts, [event.taskId]: draft } })
        }
        const text = ((this.state.output[event.runId] ?? '') + event.text).slice(-LIMITS.outputChars)
        return this.set({ output: boundKeys({ ...this.state.output, [event.runId]: text }, LIMITS.outputRuns) })
      }
      case 'run.activity': {
        const list = [...(this.state.activity[event.runId] ?? []), event.activity].slice(-LIMITS.activityPerRun)
        return this.set({ activity: boundKeys({ ...this.state.activity, [event.runId]: list }, LIMITS.outputRuns) })
      }
      case 'run.updated': {
        const merged = mergeRun(this.state.runs[event.run.id], event.run)
        const patch: Partial<AppState> = { runs: pruneRuns({ ...this.state.runs, [event.run.id]: merged }) }
        // The finished run carries the complete list: the live copy is no longer needed.
        if (TERMINAL.has(merged.status) && this.state.activity[event.run.id]) {
          const { [event.run.id]: _done, ...rest } = this.state.activity
          patch.activity = rest
        }
        return this.set(patch)
      }
      case 'evidence.recorded': {
        const list = this.state.evidence[event.evidence.taskId] ?? []
        if (list.some((e) => e.id === event.evidence.id)) return
        return this.set({ evidence: { ...this.state.evidence, [event.evidence.taskId]: [...list, event.evidence] } })
      }
      case 'project.updated': return this.set({ projects: [...this.state.projects.filter((p) => p.id !== event.project.id), event.project] })
      case 'project.removed': return this.set({ projects: this.state.projects.filter((p) => p.id !== event.projectId) })
      case 'providers.updated': return this.set({ providers: event.providers })
      case 'device.updated': return this.set({ devices: [...this.state.devices.filter((d) => d.id !== event.device.id), event.device] })
    }
  }
}

/** A run never goes back from finished to running when an older copy arrives late. */
function mergeRun(current: AgentRunInfo | undefined, next: AgentRunInfo): AgentRunInfo {
  if (!current) return next
  if (TERMINAL.has(current.status) && !TERMINAL.has(next.status)) return current
  return next
}

/** Keeps at most LIMITS.runs runs: the oldest finished ones go first. */
function pruneRuns(runs: Record<string, AgentRunInfo>): Record<string, AgentRunInfo> {
  const ids = Object.keys(runs)
  if (ids.length <= LIMITS.runs) return runs
  const finished = ids.filter((id) => runs[id]!.status !== 'running').sort((a, b) => (runs[a]!.endedAt ?? '').localeCompare(runs[b]!.endedAt ?? ''))
  const next = { ...runs }
  for (const id of finished.slice(0, ids.length - LIMITS.runs)) delete next[id]
  return next
}

/** Bounds a per-run map: the earliest keys (insertion order) are dropped first. */
function boundKeys<T>(map: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(map)
  if (keys.length <= max) return map
  const next = { ...map }
  for (const key of keys.slice(0, keys.length - max)) delete next[key]
  return next
}

/**
 * Subscribes to a slice of the engine state. The component re-renders only when the
 * selected value changes (Object.is, or the given equality).
 */
export function useEngine<T>(store: EngineStore, selector: (state: AppState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  // The selector is usually an inline function (it may close over props): keep the latest
  // one in a ref, and cache per (state, selector) so repeated reads in one render agree.
  const current = useRef({ selector, isEqual })
  current.current = { selector, isEqual }
  const last = useRef<{ state: AppState; selector: unknown; value: T } | null>(null)
  const getSnapshot = useCallback(() => {
    const state = store.get()
    const { selector: select, isEqual: equal } = current.current
    const previous = last.current
    if (previous && previous.state === state && previous.selector === select) return previous.value
    const value = select(state)
    const kept = previous && equal(previous.value, value) ? previous.value : value
    last.current = { state, selector: select, value: kept }
    return kept
  }, [store])
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** Shallow equality for arrays and plain objects (for selectors that build lists). */
export function shallow<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
