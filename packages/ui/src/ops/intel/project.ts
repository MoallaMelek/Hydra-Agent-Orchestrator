import { useEffect, useMemo } from 'react'
import type { AgentRunInfo, Task } from '@hydra/protocol'
import { shallow } from '../../api/store'
import { useApp, useAppState } from '../../app/context'
import { emptyCounts, fileTarget, type IntelGraph, type IntelNode, type IntelStatus } from './graph'
import { layoutProject, type Positions, type ProjectEntry } from './layout'

const MAX_MISSIONS = 24
const LOAD_RUNS = 12

function missionStatus(t: Task): IntelStatus {
  if (t.status === 'waiting_input') return 'waiting'
  if (t.status === 'running' || t.status === 'queued') return 'running'
  if (t.status === 'failed') return 'failed'
  if (t.status === 'completed') return 'ok'
  return 'canceled'
}

export interface ProjectNetwork { graph: IntelGraph; layout: Positions; missions: number; withRuns: number; truncated: boolean }

/**
 * Project lens: recent change missions as cores on a ring, linked only through files they
 * recorded touching (reported edits and reads of runs loaded in this window) or planned to
 * touch. Missions whose runs are not loaded contribute planned files only; the caller says so.
 */
export function useProjectNetwork(projectId: string | undefined): ProjectNetwork {
  const { store } = useApp()
  const tasks = useAppState((s) => Object.values(s.tasks).filter((t) => t.projectId === projectId && t.intent === 'change' && !t.archivedAt), shallow)
  const runs = useAppState((s) => Object.values(s.runs).filter((r) => tasks.some((t) => t.id === r.taskId)), shallow)
  // Load the recorded runs of the most recent missions (read-only), so their links are observed.
  const loaded = useAppState((s) => s.loaded)
  useEffect(() => {
    const recent = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, LOAD_RUNS)
    for (const t of recent) if (!loaded[t.id]) void store.loadTask(t.id)
  }, [tasks, loaded, store])
  return useMemo(() => {
    const recent = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_MISSIONS)
    const runsOf = new Map<string, AgentRunInfo[]>()
    for (const r of runs) runsOf.set(r.taskId, [...(runsOf.get(r.taskId) ?? []), r])
    const entries: ProjectEntry[] = recent.map((t) => {
      const files = new Map<string, 'edit' | 'read' | 'planned'>()
      for (const p of t.plan?.filesLikelyTouched ?? []) files.set(p.replace(/\\/g, '/').replace(/^\.\//, ''), 'planned')
      for (const r of runsOf.get(t.id) ?? []) for (const a of r.activity) {
        const path = fileTarget(a, t.workspace?.path)
        if (!path) continue
        if (a.kind === 'edit') files.set(path, 'edit')
        else if (files.get(path) !== 'edit') files.set(path, 'read')
      }
      const node: IntelNode = { id: `task:${t.id}`, kind: 'mission', label: t.title, detail: t.prompt, basis: 'observed', status: missionStatus(t), actor: 'human', at: Date.parse(t.createdAt), end: Date.parse(t.updatedAt), weight: 1 + files.size }
      return { id: node.id, label: t.title, node, files: [...files].map(([path, kind]) => ({ path, kind })) }
    })
    const { nodes, edges, pos } = layoutProject(entries)
    const counts = emptyCounts()
    for (const n of nodes) counts[n.kind]++
    const start = Math.min(...nodes.map((n) => n.at ?? Infinity), Date.now())
    const graph = { task: undefined, nodes, edges, byId: new Map(nodes.map((n) => [n.id, n])), start, end: Date.now(), moments: [], live: false, counts, gaps: [] } as unknown as IntelGraph
    return { graph, layout: pos, missions: recent.length, withRuns: recent.filter((t) => runsOf.has(t.id)).length, truncated: tasks.length > MAX_MISSIONS }
  }, [tasks, runs])
}
