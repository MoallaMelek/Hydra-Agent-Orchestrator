/** Words for the evidence network (design/VOICE.md): what was recorded, never what an agent "thinks". */
import type { Basis, IntelGraph, IntelKind, IntelNode } from './graph'

export const KIND_NAME: Record<IntelKind, string> = { mission: 'Mission', stage: 'Stage', run: 'Agent run', file: 'File', revision: 'Revision', check: 'Engine check', finding: 'Review finding', decision: 'Your decision' }
export const KIND_PLURAL: Record<IntelKind, string> = { mission: 'Missions', stage: 'Stages', run: 'Runs', file: 'Files', revision: 'Revisions', check: 'Checks', finding: 'Findings', decision: 'Decision' }
export const BASIS_TEXT: Record<Basis, string> = { observed: 'Observed', derived: 'Derived', planned: 'Planned', unavailable: 'Unavailable' }
export const BASIS_HELP: Record<Basis, string> = {
  observed: 'Recorded directly by the engine.',
  derived: 'Computed from recorded facts by a stated rule.',
  planned: 'Stated intent from the plan, not an outcome.',
  unavailable: 'Known to exist but not retained in this data.'
}
export const ROLE_NAME: Record<string, string> = { planner: 'Planner', implementer: 'Implementer', reviewer: 'Reviewer', engine: 'Hydra engine', human: 'You' }

export function statusWord(n: IntelNode): string {
  if (n.kind === 'check') return n.status === 'ok' ? 'Passed' : n.status === 'running' ? 'Running' : 'Failed'
  if (n.kind === 'finding') return n.finding!.severity[0]!.toUpperCase() + n.finding!.severity.slice(1)
  if (n.kind === 'decision') return n.status === 'blocked' ? 'Blocked' : n.status === 'waiting' ? 'Waiting for you' : n.status === 'ok' ? 'Accepted' : n.status === 'canceled' ? 'Closed' : 'Not reached'
  return { running: 'Running', ok: 'Succeeded', failed: 'Failed', waiting: 'Waiting', blocked: 'Blocked', canceled: 'Canceled', idle: '' }[n.status]
}

export const fmtDuration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
export const fmtOffset = (t: number, start: number) => { const s = Math.max(0, (t - start) / 1000); return s < 60 ? `+${s.toFixed(1)}s` : `+${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` }

const EDGE_VERB: Record<string, [string, string]> = {
  sequence: ['came after', 'handed off to'], performs: ['ran in', 'ran'], read: ['read by', 'read'], edit: ['edited by', 'edited'],
  produced: ['produced by', 'produced'], parent: ['followed', 'followed by'], tested: ['tested by', 'tested'], reviewed: ['reviewed by', 'reviewed'],
  raised: ['raised by', 'raised'], concerns: ['flagged by', 'concerns'], planned: ['planned in', 'plans to touch'], changed: ['changed in', 'changes'], decides: ['decided by', 'decides on']
}

/** Neighbours with a plain verb for the edge that joins them, each node once per direction. */
export function neighbours(g: IntelGraph, id: string): { ins: Array<{ node: IntelNode; verb: string }>; outs: Array<{ node: IntelNode; verb: string }> } {
  const ins = new Map<string, { node: IntelNode; verb: string }>(), outs = new Map<string, { node: IntelNode; verb: string }>()
  for (const e of g.edges) {
    if (e.to === id && g.byId.has(e.from) && !ins.has(e.from)) ins.set(e.from, { node: g.byId.get(e.from)!, verb: EDGE_VERB[e.kind]?.[0] ?? e.kind })
    if (e.from === id && g.byId.has(e.to) && !outs.has(e.to)) outs.set(e.to, { node: g.byId.get(e.to)!, verb: EDGE_VERB[e.kind]?.[1] ?? e.kind })
  }
  return { ins: [...ins.values()], outs: [...outs.values()] }
}

export const providerName = (id: string) => id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex CLI' : id === 'scripted' ? 'Scripted test agent' : id
