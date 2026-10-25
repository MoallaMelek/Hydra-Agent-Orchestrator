import { useMemo } from 'react'
import type { Task } from '@hydra/protocol'
import { useAppState } from '../../app/context'
import { useLiveActivity, useNow, useTaskEvidence, useTaskRuns } from '../hooks'
import { useTaskDiff } from '../../views/task/useTaskData'
import { buildIntel, type IntelGraph } from './graph'

const NO_REVIEWS: never[] = []

/**
 * The evidence graph for one mission, from what the store already holds: task, runs (with
 * live tool calls merged for running runs), checks, the review ledger and the diff when the
 * worktree still exists. Read-only; nothing here sends a command.
 */
export function useIntel(task: Task): { graph: IntelGraph; diffError: string | null } {
  const runs = useTaskRuns(task.id)
  const evidence = useTaskEvidence(task.id)
  const live = useLiveActivity(runs)
  const reviews = useAppState((s) => s.reviews[task.id] ?? NO_REVIEWS)
  const running = task.status === 'running' || task.status === 'queued'
  const now = useNow(running)
  const hasWorkspace = Boolean(task.workspace && !task.workspace.removed && task.workspace.headSha)
  const { diff, error } = useTaskDiff(task.id, task.workspace?.headSha, hasWorkspace && task.intent === 'change')
  const merged = useMemo(() => runs.map((r) => {
    const l = live[r.id]
    return l && l.length > r.activity.length ? { ...r, activity: l } : r
  }), [runs, live])
  const graph = useMemo(() => buildIntel({ task, runs: merged, evidence, diff: hasWorkspace ? diff : null, reviews, now: Math.max(now, Date.now()) }), [task, merged, evidence, diff, hasWorkspace, reviews, now])
  return { graph, diffError: error }
}
