import { useEffect, useMemo, useState } from 'react'
import type { AgentRunInfo, Evidence, ProviderId, RunActivity } from '@hydra/protocol'
import { shallow } from '../api/store'
import { useApp, useAppState } from '../app/context'
import { buildTrace, type Trace } from './model'

/**
 * Wall-clock time for live drawings, advanced once a second and only while something is
 * live and the window is visible. Nothing is animated between ticks.
 */
export function useNow(live: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) { setNow(Date.now()); return }
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => setNow(Date.now()), everyMs) }
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); start() } else stop() }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [live, everyMs])
  return now
}

/** Runs of one task, as a stable list (re-renders only when one of them changes). */
export function useTaskRuns(taskId: string): AgentRunInfo[] {
  return useAppState((s) => Object.values(s.runs).filter((r) => r.taskId === taskId), shallow)
}

export function useTaskEvidence(taskId: string): Evidence[] {
  return useAppState((s) => s.evidence[taskId] ?? EMPTY_EVIDENCE)
}
const EMPTY_EVIDENCE: Evidence[] = []

/** Live tool calls of this task's running runs. */
export function useLiveActivity(runs: AgentRunInfo[]): Record<string, RunActivity[]> {
  const ids = runs.filter((r) => r.status === 'running').map((r) => r.id)
  return useAppState((s) => Object.fromEntries(ids.map((id) => [id, s.activity[id] ?? EMPTY_ACTIVITY])), shallow)
}
const EMPTY_ACTIVITY: RunActivity[] = []

/** Agent processes running right now across all tasks, and the engine's limit. */
export function useSlots(): { busy: number; limit: number; runs: AgentRunInfo[] } {
  const runs = useAppState((s) => Object.values(s.runs).filter((r) => r.status === 'running'), shallow)
  const limit = useAppState((s) => s.agentSlots)
  return useMemo(() => ({ busy: runs.length, limit, runs }), [runs, limit])
}

export function useProviderName(): (id: ProviderId) => string {
  const providers = useAppState((s) => s.providers)
  return useMemo(() => (id: ProviderId) => providers.find((p) => p.id === id)?.displayName ?? (id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex CLI' : id), [providers])
}

/** Loads the task's runs and checks once; afterwards they stay current from engine events. */
export function useTaskLoaded(taskId: string): boolean {
  const { store } = useApp()
  useEffect(() => { void store.loadTask(taskId) }, [store, taskId])
  return useAppState((s) => Boolean(s.loaded[taskId]))
}

/** The Relay trace for a task at `now` (or frozen at a moment for replay). */
export function useTrace(taskId: string, now: number): Trace | null {
  const task = useAppState((s) => s.tasks[taskId])
  const runs = useTaskRuns(taskId)
  const evidence = useTaskEvidence(taskId)
  const liveActivity = useLiveActivity(runs)
  const slots = useSlots()
  const providerName = useProviderName()
  // New data rebuilds the trace at the current time, so work that started since the last tick is drawn.
  return useMemo(() => task ? buildTrace({ task, runs, evidence, liveActivity, slots: { busy: slots.busy, limit: slots.limit }, providerName, now: Math.max(now, Date.now()) }) : null,
    [task, runs, evidence, liveActivity, slots.busy, slots.limit, providerName, now])
}
