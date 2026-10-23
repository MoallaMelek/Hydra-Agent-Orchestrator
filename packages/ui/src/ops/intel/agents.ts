/**
 * Agents and handoffs, derived from run records only.
 *
 * An agent is a (role, provider) pair named in run records: "Implementer · Claude Code".
 * A handoff links two consecutive runs only when a recorded artifact connects them:
 * - planner → implementer: the plan the engine stored for the mission
 * - any → reviewer: the revision that reviewer is recorded as reviewing
 * - reviewer → repair: the findings that reviewer raised
 * - any → repair after failed checks: the failed check results on the latest revision
 * Agents never talk to each other in Hydra; the engine passes these artifacts between turns.
 * No artifact, no handoff edge: the stage ring still shows the order.
 */
import type { AgentRole, Task } from '@hydra/protocol'
import type { AgentFacts, Basis, EdgeKind, IntelEdge, IntelNode } from './graph'

type Add = (n: IntelNode) => IntelNode
type Link = (from: string, to: string, kind: EdgeKind, basis: Basis, at: number | null, extra?: Pick<IntelEdge, 'label' | 'via'>) => void

const ROLE: Record<string, string> = { planner: 'Planner', implementer: 'Implementer', reviewer: 'Reviewer' }
export const providerLabel = (id: string) => id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex CLI' : id === 'scripted' ? 'Test agent' : id
export const agentId = (role: string, provider: string) => `agent:${role}:${provider}`
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function addAgents(task: Task, nodes: IntelNode[], edges: IntelEdge[], add: Add, link: Link): void {
  const runs = nodes.filter((n) => n.kind === 'run' && n.runFacts).sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  if (!runs.length) return
  const out = (from: string, kind: EdgeKind) => edges.filter((e) => e.from === from && e.kind === kind)

  // Agents
  const groups = new Map<string, IntelNode[]>()
  for (const r of runs) { const f = r.runFacts!.run; const id = agentId(f.role, f.provider); groups.set(id, [...(groups.get(id) ?? []), r]) }
  for (const [id, list] of groups) {
    const first = list[0]!.runFacts!.run
    const facts: AgentFacts = {
      role: first.role as AgentRole, provider: first.provider, runs: list.map((r) => r.id),
      toolCalls: list.reduce((s, r) => s + r.runFacts!.activity.length, 0),
      edits: list.reduce((s, r) => s + r.runFacts!.edits, 0),
      revisions: list.reduce((s, r) => s + out(r.id, 'produced').length, 0),
      findings: list.reduce((s, r) => s + out(r.id, 'raised').length, 0),
      activeMs: list.reduce((s, r) => s + (r.end !== null && r.at !== null ? r.end - r.at : 0), 0),
      tokens: list.reduce((s, r) => s + r.runFacts!.run.usage.inputTokens + r.runFacts!.run.usage.outputTokens, 0),
      costUsd: list.reduce((s, r) => s + (r.runFacts!.run.usage.costUsd ?? 0), 0)
    }
    const status = list.some((r) => r.status === 'running') ? 'running' : list.at(-1)!.status
    add({ id, kind: 'agent', label: `${ROLE[first.role] ?? first.role} · ${providerLabel(first.provider)}`, detail: `${plural(list.length, 'run')} · ${plural(facts.toolCalls, 'reported call')}`, basis: 'observed', status, actor: first.role as AgentRole, at: list[0]!.at, end: list.every((r) => r.end !== null) ? Math.max(...list.map((r) => r.end!)) : null, weight: 2 + list.length, agent: facts })
    for (const r of list) link(id, r.id, 'acts', 'observed', r.at)
  }

  // Handoffs between consecutive runs
  const checks = nodes.filter((n) => n.kind === 'check')
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1]!, b = runs[i]!
    const ra = a.runFacts!.run, rb = b.runFacts!.run
    const at = b.at
    if (rb.role === 'reviewer') {
      const rev = out(b.id, 'reviewed')[0]?.to
      if (rev) link(a.id, b.id, 'handoff', 'derived', at, { label: `revision ${rev.slice(4)}`, via: [rev] })
      continue
    }
    if (rb.role === 'implementer' && rb.stage === 'implement' && ra.role === 'planner' && task.plan) {
      link(a.id, b.id, 'handoff', 'derived', at, { label: 'the plan', via: [] })
      continue
    }
    if (rb.role === 'implementer' && rb.stage === 'fix') {
      const raised = out(a.id, 'raised').map((e) => e.to)
      if (ra.role === 'reviewer' && raised.length) { link(a.id, b.id, 'handoff', 'derived', at, { label: plural(raised.length, 'finding'), via: raised }); continue }
      const failed = checks.filter((c) => c.status === 'failed' && c.end !== null && at !== null && c.end <= at && (a.end === null || c.end >= (a.at ?? 0)))
      if (failed.length) link(a.id, b.id, 'handoff', 'derived', at, { label: plural(failed.length, 'failed check'), via: failed.map((c) => c.id) })
    }
  }
}
