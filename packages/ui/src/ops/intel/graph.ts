/**
 * Evidence graph: a read-only projection of what Hydra recorded about one mission.
 *
 * Every node and edge says how it is known:
 * - observed    recorded directly by the engine (stage records, run records, tool reports,
 *               check results, review records, diff, acceptance receipt)
 * - derived     computed from observed records by a stated rule (e.g. "the run in the stage
 *               whose note names commit X produced X")
 * - planned     stated intent, not an outcome (the plan's likely files and acceptance criteria)
 * - unavailable known to exist but not retained in the data this view received
 *
 * Nothing here invents activity, thinking, agent-to-agent messages, progress percentages or
 * parallelism. Agents take turns inside one mission; the sequence edges are the recorded order.
 */
import { approvalContext, type AgentRole, type AgentRunInfo, type Evidence, type Review, type RunActivity, type Task, type TaskDiff, type TaskStage } from '@hydra/protocol'

export type Basis = 'observed' | 'derived' | 'planned' | 'unavailable'
export type IntelKind = 'mission' | 'stage' | 'run' | 'file' | 'revision' | 'check' | 'finding' | 'decision'
export type IntelStatus = 'running' | 'ok' | 'failed' | 'waiting' | 'blocked' | 'canceled' | 'idle'
export type Actor = AgentRole | 'engine' | 'human'
export type EdgeKind =
  | 'sequence'   // stage → next stage (recorded order)
  | 'performs'   // stage → run
  | 'read' | 'edit' // run → file (reported tool call)
  | 'produced'   // run → revision
  | 'parent'     // revision → next revision
  | 'tested'     // check → revision
  | 'reviewed'   // run (reviewer) → revision
  | 'raised'     // run (reviewer) → finding
  | 'concerns'   // finding → file
  | 'planned'    // mission → file (plan.filesLikelyTouched)
  | 'changed'    // revision → file (final diff)
  | 'decides'    // decision → revision

export interface FileFacts {
  path: string
  planned: boolean
  reads: number
  edits: number
  /** From the final base→head diff, when it was received. */
  diff: { status: string; additions: number; deletions: number; patch: string } | null
  findings: number
  touchedBy: Actor[]
}

export interface RunFacts {
  run: AgentRunInfo
  reads: number
  edits: number
  searches: number
  commands: string[]
  activity: RunActivity[]
}

export interface IntelNode {
  id: string
  kind: IntelKind
  label: string
  detail: string
  basis: Basis
  status: IntelStatus
  actor: Actor | null
  /** Epoch ms when the record came into existence; null when unknown. */
  at: number | null
  end: number | null
  stage?: TaskStage
  attempt?: number
  /** Relative visual weight (activity count, lines changed, etc.), always ≥ 1. */
  weight: number
  file?: FileFacts
  runFacts?: RunFacts
  evidence?: Evidence
  finding?: Review['findings'][number] & { review: number; reviewedSha: string | null }
  revision?: { sha: string; short: string; role: 'base' | 'work' | 'head' | 'applied'; index: number }
  stageRecord?: Task['stages'][number]
  decision?: { waiting: Task['waitReason']; outcome: Task['outcome']; acceptance: Task['acceptance'] | null; unresolved: string[]; allowed: boolean }
}

export interface IntelEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
  basis: Basis
  at: number | null
}

export interface ReviewSnapshot { review: Review; reviewedSha: string | null; at: number }

export interface IntelInput {
  task: Task
  runs: readonly AgentRunInfo[]
  evidence: readonly Evidence[]
  diff?: TaskDiff | null
  /** Distinct reviews in recorded order. When absent, only the task's current review is known. */
  reviews?: readonly ReviewSnapshot[]
  now: number
}

export interface IntelGraph {
  task: Task
  nodes: IntelNode[]
  edges: IntelEdge[]
  byId: Map<string, IntelNode>
  start: number
  end: number
  /** Sorted distinct recorded instants, for replay. */
  moments: number[]
  live: boolean
  counts: Record<IntelKind, number>
  /** Facts the view could not show because the data was not received. */
  gaps: string[]
}

const ms = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) : null)
const shortSha = (sha: string) => sha.slice(0, 7)
const COMMIT_NOTE = /Commit ([0-9a-f]{7,40})/
const ROLE_OF_STAGE: Partial<Record<TaskStage, AgentRole>> = { plan: 'planner', implement: 'implementer', fix: 'implementer', review: 'reviewer' }
export const STAGE_LABEL: Record<TaskStage, string> = { plan: 'Plan', implement: 'Build', review: 'Review', fix: 'Repair', verify: 'Checks', demo: 'Before / after', approval: 'Your decision', apply: 'Apply' }
export const passedEvidence = (e: Evidence) => e.exitCode === 0 && !e.timedOut && !e.spawnError && !e.treeMutated

function runStatus(r: AgentRunInfo): IntelStatus {
  return r.status === 'running' ? 'running' : r.status === 'succeeded' ? 'ok' : r.status === 'canceled' || r.status === 'interrupted' ? 'canceled' : 'failed'
}
function stageStatus(s: Task['stages'][number], task: Task): IntelStatus {
  if (s.status === 'running') return task.status === 'waiting_input' ? 'waiting' : 'running'
  if (s.status === 'succeeded') return s.stage === 'verify' && /failed/.test(s.note ?? '') ? 'failed' : 'ok'
  if (s.status === 'failed') return 'failed'
  if (s.status === 'skipped') return 'idle'
  return 'canceled'
}

/** Normalises a reported tool target to a repository-relative file path, or null when it is not a file. */
export function fileTarget(a: RunActivity): string | null {
  if (a.kind !== 'read' && a.kind !== 'edit') return null
  const t = a.target.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!t || /\s/.test(t) || t.includes('*')) return null
  return t
}

export function buildIntel(input: IntelInput): IntelGraph {
  const { task, now } = input
  const nodes: IntelNode[] = []
  const edges: IntelEdge[] = []
  const byId = new Map<string, IntelNode>()
  const gaps: string[] = []
  const add = (n: IntelNode) => { if (!byId.has(n.id)) { byId.set(n.id, n); nodes.push(n) } return byId.get(n.id)! }
  const link = (from: string, to: string, kind: EdgeKind, basis: Basis, at: number | null) => {
    const id = `${kind}:${from}>${to}`
    if (!edges.some((e) => e.id === id)) edges.push({ id, from, to, kind, basis, at })
  }
  const runs = [...input.runs].filter((r) => r.taskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const evidence = [...input.evidence].filter((e) => e.taskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const live = task.status === 'running' || task.status === 'queued' || task.status === 'waiting_input'
  const created = ms(task.createdAt)!

  // Mission
  add({ id: 'mission', kind: 'mission', label: task.title || task.prompt.slice(0, 80), detail: task.prompt, basis: 'observed', status: task.status === 'failed' ? 'failed' : task.status === 'completed' ? 'ok' : task.status === 'waiting_input' ? 'waiting' : task.status === 'canceled' ? 'canceled' : 'running', actor: 'human', at: created, end: ms(task.updatedAt), weight: 3 })

  // Stage attempts, in recorded order
  const stages = [...task.stages].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  stages.forEach((s, i) => {
    const id = `stage:${s.stage}:${s.attempt}`
    const role = ROLE_OF_STAGE[s.stage]
    add({ id, kind: 'stage', label: `${STAGE_LABEL[s.stage]}${s.attempt > 1 ? ` · attempt ${s.attempt}` : ''}`, detail: s.note ?? '', basis: 'observed', status: stageStatus(s, task), actor: role ?? (s.stage === 'approval' || s.stage === 'apply' ? 'human' : 'engine'), at: ms(s.startedAt), end: ms(s.endedAt), stage: s.stage, attempt: s.attempt, weight: 1, stageRecord: s })
    if (i > 0) { const p = stages[i - 1]!; link(`stage:${p.stage}:${p.attempt}`, id, 'sequence', 'observed', ms(s.startedAt)) }
  })
  const stageOfRun = (r: AgentRunInfo) => {
    const t0 = ms(r.startedAt)!
    const candidates = stages.filter((s) => s.stage === r.stage && ms(s.startedAt)! <= t0 + 1)
    return candidates.at(-1) ?? null
  }

  // Plan: likely files are intent, not outcome
  const files = new Map<string, FileFacts>()
  const fileNode = (path: string): FileFacts => {
    let f = files.get(path)
    if (!f) { f = { path, planned: false, reads: 0, edits: 0, diff: null, findings: 0, touchedBy: [] }; files.set(path, f) }
    return f
  }
  const planAt = ms(stages.find((s) => s.stage === 'plan')?.endedAt) ?? created
  for (const p of task.plan?.filesLikelyTouched ?? []) { fileNode(p.replace(/\\/g, '/').replace(/^\.\//, '')).planned = true }

  // Runs and their reported tool calls
  for (const r of runs) {
    const id = `run:${r.id}`
    const facts: RunFacts = { run: r, reads: 0, edits: 0, searches: 0, commands: [], activity: r.activity }
    for (const a of r.activity) {
      if (a.kind === 'read') facts.reads++
      else if (a.kind === 'edit') facts.edits++
      else if (a.kind === 'search') facts.searches++
      else if (a.kind === 'command') facts.commands.push(a.target)
      const path = fileTarget(a)
      if (path) {
        const f = fileNode(path)
        if (a.kind === 'read') f.reads++; else f.edits++
        if (!f.touchedBy.includes(r.role)) f.touchedBy.push(r.role)
        link(id, `file:${path}`, a.kind === 'edit' ? 'edit' : 'read', 'observed', ms(a.at))
      }
    }
    const s = stageOfRun(r)
    const roleName = r.role === 'planner' ? 'Planner' : r.role === 'implementer' ? 'Implementer' : 'Reviewer'
    add({ id, kind: 'run', label: `${roleName} · ${STAGE_LABEL[r.stage]}${s && s.attempt > 1 ? ` ${s.attempt}` : ''}`, detail: r.error ?? r.tail.slice(-400), basis: 'observed', status: runStatus(r), actor: r.role, at: ms(r.startedAt), end: ms(r.endedAt), stage: r.stage, attempt: s?.attempt, weight: 1 + r.activity.length, runFacts: facts })
    if (s) link(`stage:${s.stage}:${s.attempt}`, id, 'performs', 'observed', ms(r.startedAt))
  }

  // Revisions: base, commits named in stage notes, evidence commits, reviewed, head, applied
  const revs: Array<{ sha: string; at: number | null; role: 'base' | 'work' | 'head' | 'applied' }> = []
  const known = (sha: string) => revs.find((r) => r.sha.startsWith(sha) || sha.startsWith(r.sha))
  const addRev = (sha: string | null | undefined, at: number | null, role: 'base' | 'work' | 'head' | 'applied') => {
    if (!sha) return null
    const k = known(sha)
    if (k) { if (sha.length > k.sha.length) k.sha = sha; if (role === 'head' || role === 'applied') k.role = role; if (k.at === null || (at !== null && at < k.at)) k.at = at ?? k.at; return k }
    const r = { sha, at, role }; revs.push(r); return r
  }
  addRev(task.workspace?.baseSha, ms(stages[0]?.startedAt) ?? created, 'base')
  for (const s of stages) { const m = COMMIT_NOTE.exec(s.note ?? ''); if (m) addRev(m[1], ms(s.endedAt), 'work') }
  for (const e of evidence) addRev(e.commitSha, ms(e.startedAt), 'work')
  addRev(task.workspace?.headSha, null, 'head')
  addRev(task.applied?.afterSha, ms(task.acceptance?.at), 'applied')
  revs.sort((a, b) => (a.role === 'base' ? -1 : b.role === 'base' ? 1 : (a.at ?? Infinity) - (b.at ?? Infinity)))
  const revId = (sha: string | null | undefined) => { if (!sha) return null; const k = known(sha); return k ? `rev:${shortSha(k.sha)}` : null }
  revs.forEach((r, i) => {
    const id = `rev:${shortSha(r.sha)}`
    add({ id, kind: 'revision', label: shortSha(r.sha), detail: r.role === 'base' ? 'Your branch when the mission started' : r.role === 'applied' ? 'Applied to your branch' : r.role === 'head' ? 'Current proposed revision' : 'Intermediate revision', basis: 'observed', status: 'idle', actor: r.role === 'base' ? 'human' : 'implementer', at: r.at, end: null, weight: 1, revision: { sha: r.sha, short: shortSha(r.sha), role: r.role, index: i } })
    // Order of revisions is the order they appeared in records; ancestry itself is not in the data.
    if (i > 0) link(`rev:${shortSha(revs[i - 1]!.sha)}`, id, 'parent', 'derived', r.at)
  })
  for (const s of stages) {
    const m = COMMIT_NOTE.exec(s.note ?? '')
    const rid = m ? revId(m[1]) : null
    if (!rid) continue
    const run = runs.filter((r) => r.stage === s.stage && stageOfRun(r)?.attempt === s.attempt).at(-1)
    if (run) link(`run:${run.id}`, rid, 'produced', 'derived', ms(s.endedAt))
  }

  // Checks bound to the exact revision they ran on
  for (const e of evidence) {
    const id = `check:${e.id}`
    const end = ms(e.startedAt)! + e.durationMs
    add({ id, kind: 'check', label: e.label, detail: e.phase === 'demo_base' ? 'On your original branch, for the before/after comparison' : e.phase === 'pre_review' ? 'Before review' : e.phase === 'verify' ? 'Verification' : 'Result comparison', basis: 'observed', status: passedEvidence(e) ? 'ok' : 'failed', actor: 'engine', at: ms(e.startedAt), end, weight: 1, evidence: e })
    const rid = revId(e.commitSha)
    if (rid) link(id, rid, 'tested', 'observed', end)
  }

  // Reviews and their findings
  const reviews: ReviewSnapshot[] = input.reviews?.length ? [...input.reviews] : task.review ? [{ review: task.review, reviewedSha: task.reviewedSha ?? null, at: ms(stages.filter((s) => s.stage === 'review').at(-1)?.endedAt) ?? ms(task.updatedAt)! }] : []
  const reviewStages = stages.filter((s) => s.stage === 'review' && s.status !== 'running')
  if (!input.reviews?.length && reviewStages.length > reviews.length) {
    gaps.push(`${reviewStages.length - reviews.length} earlier review record(s) are not retained by this view; their stage notes remain.`)
  }
  reviews.forEach((rv, ri) => {
    const reviewer = runs.filter((r) => r.role === 'reviewer' && ms(r.endedAt) !== null && ms(r.endedAt)! <= rv.at + 2000).at(-1)
    const rid = revId(rv.reviewedSha)
    if (reviewer && rid) link(`run:${reviewer.id}`, rid, 'reviewed', 'observed', rv.at)
    rv.review.findings.forEach((f, fi) => {
      const id = `finding:${ri}:${fi}`
      add({ id, kind: 'finding', label: f.issue, detail: f.suggestion, basis: 'observed', status: f.severity === 'blocker' || f.severity === 'major' ? 'blocked' : 'idle', actor: 'reviewer', at: rv.at, end: null, weight: f.severity === 'blocker' ? 3 : f.severity === 'major' ? 2 : 1, finding: { ...f, review: ri, reviewedSha: rv.reviewedSha } })
      if (reviewer) link(`run:${reviewer.id}`, id, 'raised', 'observed', rv.at)
      if (f.file) { const p = f.file.replace(/\\/g, '/'); fileNode(p).findings++; link(id, `file:${p}`, 'concerns', 'observed', rv.at) }
    })
  })

  // Final diff (base → current head). It describes the head only, so it is dated at the head.
  const head = revs.find((r) => r.role === 'head' || r.role === 'applied')
  if (input.diff && 'files' in input.diff) {
    for (const df of input.diff.files) {
      const f = fileNode(df.path)
      f.diff = { status: df.status, additions: df.additions, deletions: df.deletions, patch: df.patch }
      const hid = revId(input.diff.headSha)
      if (hid) link(hid, `file:${df.path}`, 'changed', 'observed', head?.at ?? null)
    }
    if (input.diff.truncated) gaps.push('The diff was truncated by the engine; some files are not listed.')
  } else if (task.intent === 'change' && task.workspace?.removed) gaps.push('The isolated workspace was removed after delivery, so per-file line changes are no longer available.')
  else if (task.intent === 'change' && task.workspace) gaps.push('The final diff was not loaded.')

  // File nodes. A file is blocked only by an unresolved blocker/major finding in the latest review.
  const latest = reviews.length - 1
  const blocking = new Set(reviews[latest]?.review.findings.filter((f) => f.file && (f.severity === 'blocker' || f.severity === 'major')).map((f) => f.file!.replace(/\\/g, '/')) ?? [])
  for (const f of files.values()) {
    const id = `file:${f.path}`
    const touchedAt = edges.filter((e) => e.to === id && e.at !== null).map((e) => e.at!).sort((a, b) => a - b)[0] ?? null
    add({ id, kind: 'file', label: f.path.split('/').pop() ?? f.path, detail: f.path, basis: f.diff || f.reads || f.edits ? 'observed' : 'planned', status: blocking.has(f.path) ? 'blocked' : 'idle', actor: null, at: touchedAt ?? (f.planned ? planAt : null), end: null, weight: 1 + f.edits * 2 + f.reads + (f.diff ? Math.ceil((f.diff.additions + f.diff.deletions) / 4) : 0), file: f })
    if (f.planned) link('mission', id, 'planned', 'planned', planAt)
  }

  // Your decision
  if (task.intent === 'change') {
    const ctx = approvalContext(task, evidence)
    const waiting = task.status === 'waiting_input'
    const decided = task.acceptance ?? null
    const status: IntelStatus = decided || task.outcome === 'applied' ? 'ok' : task.outcome ? 'canceled' : waiting && task.waitReason === 'final_approval' ? (ctx.allowed ? 'waiting' : 'blocked') : waiting ? 'waiting' : 'idle'
    // When no approval stage was recorded, a waiting decision dates from the end of the last stage (derived).
    const lastEnd = ms(stages.at(-1)?.endedAt)
    const recordedAt = ms(stages.find((s) => s.stage === 'approval')?.startedAt)
    const at = recordedAt ?? (waiting && task.waitReason === 'plan_approval' ? planAt : waiting || decided ? lastEnd : null)
    add({ id: 'decision', kind: 'decision', label: decided ? 'Accepted' : task.outcome === 'applied' ? 'Applied' : task.outcome ? 'Closed' : waiting ? (task.waitReason === 'plan_approval' ? 'Approve the plan' : 'Your decision') : 'Your decision', detail: decided ? `Accepted ${shortSha(decided.revision)} by ${decided.actor}` : '', basis: recordedAt === null && at !== null && task.waitReason !== 'plan_approval' ? 'derived' : 'observed', status, actor: 'human', at, end: ms(decided?.at), weight: 2, decision: { waiting: task.waitReason, outcome: task.outcome, acceptance: decided, unresolved: ctx.unresolved, allowed: ctx.allowed } })
    const target = revId(decided?.revision ?? task.workspace?.headSha)
    if (target && at !== null) link('decision', target, 'decides', 'observed', at)
  }

  const moments = [...new Set([...nodes.flatMap((n) => [n.at, n.end]), ...edges.map((e) => e.at)].filter((x): x is number => typeof x === 'number'))].sort((a, b) => a - b)
  const counts = { mission: 0, stage: 0, run: 0, file: 0, revision: 0, check: 0, finding: 0, decision: 0 } as Record<IntelKind, number>
  for (const n of nodes) counts[n.kind]++
  // The domain is what was recorded; a waiting mission does not stretch to the present.
  return { task, nodes, edges, byId, start: created, end: Math.max(moments.at(-1) ?? created, live && task.status === 'running' ? now : 0), moments, live, counts, gaps }
}

/**
 * The graph as it was at `cursor`: anything recorded later is absent, and anything still
 * open at that instant shows as running. Outcomes never leak backwards.
 */
export function projectAt(g: IntelGraph, cursor: number | null): IntelGraph {
  if (cursor === null || cursor >= g.end) return g
  const keep = (n: IntelNode) => n.kind === 'mission' || (n.at !== null && n.at <= cursor)
  const nodes = g.nodes.filter(keep).map((n): IntelNode => {
    if (n.end !== null && n.end > cursor && (n.kind === 'run' || n.kind === 'stage' || n.kind === 'check')) return { ...n, status: 'running', end: null }
    if (n.kind === 'file' && n.file?.diff) return { ...n, file: { ...n.file, diff: null } }
    if (n.kind === 'mission') return { ...n, status: 'running' }
    return n
  })
  const ids = new Set(nodes.map((n) => n.id))
  const edges = g.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && (e.at === null ? e.kind === 'parent' : e.at <= cursor))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const counts = { mission: 0, stage: 0, run: 0, file: 0, revision: 0, check: 0, finding: 0, decision: 0 } as Record<IntelKind, number>
  for (const n of nodes) counts[n.kind]++
  return { ...g, nodes, edges, byId, counts, end: cursor, live: true }
}

/** Distinct reviews from a stream of task snapshots (journal or live updates), in order. */
export function reviewsFromSnapshots(snapshots: ReadonlyArray<{ at: number; task: Task }>): ReviewSnapshot[] {
  const out: ReviewSnapshot[] = []
  for (const { at, task } of snapshots) {
    if (!task.review) continue
    const key = JSON.stringify([task.review, task.reviewedSha ?? null])
    const last = out.at(-1)
    if (!last || JSON.stringify([last.review, last.reviewedSha]) !== key) out.push({ review: task.review, reviewedSha: task.reviewedSha ?? null, at })
  }
  return out
}
