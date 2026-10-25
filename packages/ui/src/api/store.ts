import { useCallback, useRef, useSyncExternalStore } from 'react'
import { DURABLE_EVENT_TYPES, type Review, type AgentRunInfo, type Device, type EngineSnapshot, type EventEnvelope, type Evidence, type Project, type ProviderStatus, type RunActivity, type Task } from '@hydra/protocol'
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
  /**
   * Distinct review records this client has seen per task, oldest first. The engine keeps only
   * the latest review on the task; earlier ones are known here only if observed live.
   */
  reviews: Record<string, ReviewRecord[]>
}

export interface ReviewRecord { review: Review; reviewedSha: string | null; at: number }

const initial: AppState = {
  ready: false, error: null, connection: 'connecting', engineVersion: '', projects: [], tasks: {}, providers: [], devices: [], remote: null,
  agentSlots: 3, runs: {}, activity: {}, evidence: {}, loaded: {}, output: {}, drafts: {}, logs: {}, reviews: {}
}

/** Memory bounds: the interface must stay small however long Hydra runs. */
export const LIMITS = { outputChars: 60_000, draftChars: 60_000, activityPerRun: 200, logLines: 300, reviewsPerTask: 12, runs: 500, outputRuns: 60, loadedTasks: 40, tasks: 500 } as const

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
    if (patch.tasks && Object.keys(patch.tasks).length > LIMITS.tasks) {
      const loaded = patch.loaded ?? this.state.loaded
      const priority = (task: Task) => loaded[task.id] ? 3 : ['running', 'queued'].includes(task.status) ? 2 : task.status === 'waiting_input' ? 1 : 0
      const retained = Object.values(patch.tasks).sort((a, b) => priority(b) - priority(a) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, LIMITS.tasks)
      patch.tasks = Object.fromEntries(retained.map(t => [t.id, t]))
    }
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

  /**
   * Applies a snapshot without ever going back in time: a snapshot taken before events
   * this store already applied (a slow reload racing the stream) keeps the newer task
   * states and does not resurrect deleted tasks.
   */
  private load(snapshot: EngineSnapshot): void {
    const stale = snapshot.lastSeq < this.lastSeq
    this.lastSeq = Math.max(this.lastSeq, snapshot.lastSeq)
    const tasks: Record<string, Task> = {}
    for (const t of snapshot.tasks) {
      if (this.deleted.has(t.id)) continue
      const mine = this.state.tasks[t.id]
      // Newer wins; on a tie the state from events is kept when the snapshot is the older of the two.
      tasks[t.id] = mine && (mine.updatedAt > t.updatedAt || (stale && mine.updatedAt === t.updatedAt)) ? mine : t
    }
    // Tasks the snapshot does not know yet were created after it was taken.
    if (stale) for (const [id, t] of Object.entries(this.state.tasks)) if (!tasks[id]) tasks[id] = t
    // A bounded boot snapshot intentionally omits older history. Keep details the
    // user has opened, rather than replacing an on-screen historical task on reconnect.
    for (const id of Object.keys(this.state.loaded)) if (!tasks[id] && this.state.tasks[id] && !this.deleted.has(id)) tasks[id] = this.state.tasks[id]!
    const runs = { ...this.state.runs }
    for (const run of snapshot.activeRuns ?? []) if (tasks[run.taskId]) runs[run.id] = mergeRun(runs[run.id], run)
    this.set({
      ready: true, error: null, engineVersion: snapshot.engineVersion, projects: snapshot.projects,
      tasks, providers: snapshot.providers, devices: snapshot.devices, remote: snapshot.remote,
      agentSlots: snapshot.agentSlots ?? 3, runs
    })
  }

  /** Task deletions seen (by journal sequence), so an older snapshot cannot bring a task back. */
  private readonly deleted = new Map<string, number>()
  /**
   * Keeps at most LIMITS.runs runs, dropping the oldest finished ones first. A task that
   * loses runs is no longer "loaded", so opening it fetches its full history again.
   */
  private pruneRuns(runs: Record<string, AgentRunInfo>, loaded: AppState['loaded']): { runs: Record<string, AgentRunInfo>; loaded: AppState['loaded'] } {
    const ids = Object.keys(runs)
    if (ids.length <= LIMITS.runs) return { runs, loaded }
    const finished = ids.filter((id) => runs[id]!.status !== 'running').sort((a, b) => (runs[a]!.endedAt ?? '').localeCompare(runs[b]!.endedAt ?? ''))
    const next = { ...runs }
    const nextLoaded = { ...loaded }
    for (const id of finished.slice(0, ids.length - LIMITS.runs)) {
      const taskId = next[id]!.taskId
      delete next[id]
      if (nextLoaded[taskId]) { delete nextLoaded[taskId]; this.loadedOrder = this.loadedOrder.filter((x) => x !== taskId) }
    }
    return { runs: next, loaded: nextLoaded }
  }

  /** Tasks with loaded details, oldest first (bounded: details are fetched again when needed). */
  private loadedOrder: string[] = []

  private markLoaded(taskId: string): Pick<AppState, 'loaded' | 'evidence'> {
    this.loadedOrder = [...this.loadedOrder.filter((id) => id !== taskId), taskId]
    const loaded = { ...this.state.loaded, [taskId]: true as const }
    const evidence = { ...this.state.evidence }
    while (this.loadedOrder.length > LIMITS.loadedTasks) {
      const old = this.loadedOrder.shift()!
      delete loaded[old]
      delete evidence[old]
    }
    return { loaded, evidence }
  }

  /** Appends the task's review when it differs from the last one seen (bounded per task and in tasks). */
  private recordReview(task: Task, at: number): Record<string, ReviewRecord[]> {
    if (!task.review) return this.state.reviews
    const list = this.state.reviews[task.id] ?? []
    const last = list.at(-1)
    const reviewedSha = task.reviewedSha ?? null
    if (last && last.reviewedSha === reviewedSha && JSON.stringify(last.review) === JSON.stringify(task.review)) return this.state.reviews
    return boundKeys({ ...this.state.reviews, [task.id]: [...list, { review: task.review, reviewedSha, at }].slice(-LIMITS.reviewsPerTask) }, LIMITS.loadedTasks)
  }

  /** Loads a task's runs and evidence once; later changes arrive as events. */
  loadTask(taskId: string, force = false): Promise<void> {
    if (this.deleted.has(taskId)) return Promise.resolve()
    if (!force && this.state.loaded[taskId]) return Promise.resolve()
    const existing = this.loading.get(taskId)
    if (existing) return existing
    const promise = this.transport.taskDetail(taskId).then((detail) => {
      if (this.deleted.has(taskId)) return
      const runs = { ...this.state.runs }
      for (const run of detail.runs) runs[run.id] = mergeRun(runs[run.id], run)
      const known = new Map((this.state.evidence[taskId] ?? []).map((e) => [e.id, e]))
      for (const e of detail.evidence) known.set(e.id, e)
      const { loaded, evidence } = this.markLoaded(taskId)
      const pruned = this.pruneRuns(runs, loaded)
      this.set({
        runs: pruned.runs,
        evidence: { ...evidence, [taskId]: [...known.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt)) },
        loaded: pruned.loaded,
        reviews: this.state.reviews[taskId]?.length ? this.state.reviews : this.recordReview(detail.task, Date.parse(detail.task.stages.filter((x) => x.stage === 'review').at(-1)?.endedAt ?? detail.task.updatedAt)),
        tasks: this.state.tasks[taskId] && detail.task.updatedAt < this.state.tasks[taskId].updatedAt ? this.state.tasks : { ...this.state.tasks, [taskId]: detail.task }
      })
    }).catch(error => { if (!this.deleted.has(taskId)) this.set({ error: `Could not load task evidence: ${(error as Error).message}. Reopen the task to retry.` }) }).finally(() => this.loading.delete(taskId))
    this.loading.set(taskId, promise)
    return promise
  }

  private apply({ seq, at, event }: EventEnvelope): void {
    // Durable events can repeat after a reconnect (the stream resumes from a cursor): apply each once.
    if (DURABLE_EVENT_TYPES.has(event.type)) {
      if (seq > 0 && seq <= this.lastSeq) return
      this.lastSeq = Math.max(this.lastSeq, seq)
    }
    if ('taskId' in event && this.deleted.has(event.taskId)) return
    if (event.type === 'task.updated' && this.deleted.has(event.task.id)) return
    if (event.type === 'run.updated' && this.deleted.has(event.run.taskId)) return
    switch (event.type) {
      case 'task.updated': {
        const current = this.state.tasks[event.task.id]
        if (current && event.task.updatedAt < current.updatedAt) return // out of order: keep the newer state
        const drafts = { ...this.state.drafts }
        if (!['running', 'queued'].includes(event.task.status)) delete drafts[event.task.id]
        return this.set({ tasks: { ...this.state.tasks, [event.task.id]: event.task }, drafts, reviews: this.recordReview(event.task, Date.parse(at)) })
      }
      case 'task.deleted': {
        // Everything cached for the task goes with it.
        const id = event.taskId
        this.deleted.set(id, seq)
        this.loadedOrder = this.loadedOrder.filter((x) => x !== id)
        const without = <T,>(map: Record<string, T>) => { const { [id]: _gone, ...rest } = map; return rest }
        const runIds = Object.values(this.state.runs).filter((r) => r.taskId === id).map((r) => r.id)
        const dropRuns = <T,>(map: Record<string, T>) => { const next = { ...map }; for (const r of runIds) delete next[r]; return next }
        return this.set({
          tasks: without(this.state.tasks), evidence: without(this.state.evidence), loaded: without(this.state.loaded), logs: without(this.state.logs),
          drafts: without(this.state.drafts), reviews: without(this.state.reviews), runs: dropRuns(this.state.runs), activity: dropRuns(this.state.activity), output: dropRuns(this.state.output)
        })
      }
      case 'task.log': {
        const lines = [...(this.state.logs[event.taskId] ?? []), { at, level: event.level, message: event.message }].slice(-LIMITS.logLines)
        return this.set({ logs: boundKeys({ ...this.state.logs, [event.taskId]: lines }, LIMITS.loadedTasks) })
      }
      case 'run.output': {
        if (event.stream === 'answer') {
          const run = this.state.runs[event.runId]
          if (run && TERMINAL.has(run.status)) return
          const task = this.state.tasks[event.taskId]
          if (task && !['running', 'queued'].includes(task.status)) return
          const draft = ((this.state.drafts[event.taskId] ?? '') + event.text).slice(-LIMITS.draftChars)
          return this.set({ drafts: boundKeys({ ...this.state.drafts, [event.taskId]: draft }, LIMITS.outputRuns) })
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
        const pruned = this.pruneRuns({ ...this.state.runs, [event.run.id]: merged }, this.state.loaded)
        const patch: Partial<AppState> = { runs: pruned.runs, loaded: pruned.loaded }
        if (merged.status === 'running' && !this.state.runs[event.run.id]) {
          const drafts = { ...this.state.drafts }; delete drafts[merged.taskId]; patch.drafts = drafts
        }
        if (TERMINAL.has(merged.status)) {
          const drafts = { ...this.state.drafts }; delete drafts[merged.taskId]; patch.drafts = drafts
        }
        // The finished run carries the complete list: the live copy is no longer needed.
        if (TERMINAL.has(merged.status) && this.state.activity[event.run.id]) {
          const { [event.run.id]: _done, ...rest } = this.state.activity
          patch.activity = rest
        }
        return this.set(patch)
      }
      case 'evidence.recorded': {
        // Only for tasks whose details are loaded; others fetch theirs when opened (keeps memory bounded).
        if (!this.state.loaded[event.evidence.taskId]) return
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
