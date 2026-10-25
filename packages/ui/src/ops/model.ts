import type { AgentRunInfo, Evidence, ProviderId, RunActivity, Task, TaskStage } from '@hydra/protocol'

/**
 * The Relay trace: a task drawn as lanes (you, the three agent roles, Hydra itself) over
 * time. Built only from what the engine reports; anything deduced rather than reported is
 * marked `basis: 'inferred'` and shown as such. Pure and deterministic for tests.
 */

export type LaneId = 'you' | 'planner' | 'implementer' | 'reviewer' | 'hydra'
export type Basis = 'observed' | 'inferred'
export type SegStatus = 'running' | 'ok' | 'failed' | 'canceled' | 'waiting' | 'interrupted'

export interface Lane { id: LaneId; title: string; actor: string; duty: string }

export interface Segment {
  id: string
  lane: LaneId
  start: number
  /** null while still going (drawn to "now"). */
  end: number | null
  kind: 'run' | 'check' | 'gate' | 'wait' | 'apply' | 'checking'
  status: SegStatus
  label: string
  basis: Basis
  stage: TaskStage | null
  attempt: number
  ref: { type: 'run'; id: string } | { type: 'evidence'; id: string } | { type: 'gate'; reason: 'plan_approval' | 'final_approval' } | { type: 'stage'; stage: TaskStage; attempt: number }
  /** Tool calls (time and kind) for agent runs. */
  ticks: Array<{ at: number; kind: RunActivity['kind'] }>
}

export interface Baton {
  id: string
  lane: LaneId
  at: number
  /** The lane this artifact is handed to (drawn as a connector), if any. */
  to: LaneId | null
  label: string
  tone: 'neutral' | 'ok' | 'bad' | 'you' | 'accent'
  kind: 'request' | 'plan' | 'changes' | 'review' | 'checks' | 'demo' | 'decision' | 'answer' | 'repair'
  basis: Basis
  ref: Segment['ref'] | null
}

export interface StageSpan { stage: TaskStage; attempt: number; start: number; end: number | null; status: Task['stages'][number]['status']; note: string | null }

export interface Headline {
  text: string
  tone: 'accent' | 'you' | 'ok' | 'bad' | 'neutral'
  basis: Basis
  /** The latest tool call the provider reported, and when. Reported calls may already be finished. */
  last?: { text: string; at: number }
}

export interface Trace {
  start: number
  /** Right edge of the drawing: stable buckets while live, so the scale changes rarely. */
  end: number
  now: number
  live: boolean
  lanes: Lane[]
  segments: Segment[]
  batons: Baton[]
  stages: StageSpan[]
  headline: Headline
  repairRounds: number
}

export interface TraceInput {
  task: Task
  runs: AgentRunInfo[]
  evidence: Evidence[]
  /** Live tool calls of running runs (the run record's own list is used once it ends). */
  liveActivity?: Record<string, RunActivity[]>
  /** Running agent processes across all tasks, and the limit (for the "waiting for a slot" inference). */
  slots?: { busy: number; limit: number }
  providerName?: (id: ProviderId) => string
  now: number
}

const t = (iso: string | null | undefined): number | null => (iso ? Date.parse(iso) : null)
const AGENT_STAGES: Partial<Record<TaskStage, LaneId>> = { plan: 'planner', implement: 'implementer', fix: 'implementer', review: 'reviewer' }
const ROLE_LANE: Record<AgentRunInfo['role'], LaneId> = { planner: 'planner', implementer: 'implementer', reviewer: 'reviewer' }
const STAGE_NAME: Record<TaskStage, string> = { plan: 'Plan', implement: 'Implement', review: 'Review', fix: 'Fix', verify: 'Verify', demo: 'Before/after', approval: 'Approval', apply: 'Apply' }
const PHASE_NAME: Record<Evidence['phase'], string> = { pre_review: 'before review', verify: 'verify', demo_base: 'original', demo_final: 'result' }

export const passed = (e: Evidence): boolean => e.exitCode === 0 && !e.timedOut && !e.spawnError && !e.treeMutated

/** Scale steps (15 s up to a day): the drawing rescales only when work crosses one. */
const BUCKETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440].map((m) => m * 60_000)

export function domainEnd(start: number, last: number, live: boolean): number {
  const span = Math.max(1000, last - start)
  if (!live) return start + span
  const wanted = span * 1.12
  return start + (BUCKETS.find((b) => b >= wanted) ?? Math.ceil(wanted / 3_600_000) * 3_600_000)
}

export function buildTrace(input: TraceInput): Trace {
  const { task, now } = input
  const name = input.providerName ?? ((id: ProviderId) => (id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex CLI' : id))
  const change = task.intent === 'change'
  const live = task.status === 'running' || task.status === 'queued' || task.status === 'waiting_input'
  const start = t(task.createdAt)!
  const runs = [...input.runs].filter((r) => r.taskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const evidence = [...input.evidence].filter((e) => e.taskId === task.id).sort((a, b) => a.startedAt.localeCompare(b.startedAt))

  const lanes: Lane[] = change
    ? [
        { id: 'you', title: 'You', actor: 'You', duty: 'Asked for the change; approves plans and the final result' },
        { id: 'planner', title: 'Planner', actor: name(task.assignment.planner), duty: 'Reads the code (read-only) and writes the plan' },
        { id: 'implementer', title: 'Implementer', actor: name(task.assignment.implementer), duty: 'Edits files in an isolated copy of your repository' },
        { id: 'reviewer', title: 'Reviewer', actor: name(task.assignment.reviewer), duty: 'Reviews the diff and Hydra\'s test results, independently' },
        { id: 'hydra', title: 'Hydra', actor: 'Hydra', duty: 'Runs your checks itself and applies only what you accept' }
      ]
    : [
        { id: 'you', title: 'You', actor: 'You', duty: 'Asked the question' },
        { id: 'planner', title: 'Answer', actor: name(task.assignment.planner), duty: 'Reads the code it needs (read-only) and replies' }
      ]

  const segments: Segment[] = []
  const batons: Baton[] = []
  const stages: StageSpan[] = task.stages.map((s) => ({ stage: s.stage, attempt: s.attempt, start: t(s.startedAt)!, end: t(s.endedAt), status: s.status, note: s.note }))

  batons.push({ id: 'request', lane: 'you', at: start, to: 'planner', label: change ? 'Request' : 'Question', tone: 'neutral', kind: 'request', basis: 'observed', ref: null })

  // Agent runs: observed segments with their tool calls.
  for (const run of runs) {
    const lane = ROLE_LANE[run.role]
    const status: SegStatus = run.status === 'succeeded' ? 'ok' : run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : run.status === 'canceled' ? 'canceled' : 'interrupted'
    const record = task.stages.filter((s) => s.stage === run.stage && t(s.startedAt)! <= t(run.startedAt)! + 1).at(-1)
    const attempt = record?.attempt ?? 1
    const activity = run.status === 'running' ? (input.liveActivity?.[run.id] ?? run.activity ?? []) : (run.activity ?? [])
    segments.push({
      id: run.id, lane, start: t(run.startedAt)!, end: run.status === 'running' ? null : t(run.endedAt) ?? t(run.startedAt)!,
      kind: 'run', status, basis: 'observed', stage: run.stage, attempt,
      label: `${run.stage === 'fix' ? `Fix ${attempt}` : change ? STAGE_NAME[run.stage] : 'Answer'}${run.stage !== 'fix' && attempt > 1 ? ` ${attempt}` : ''} · ${name(run.provider)}`,
      ref: { type: 'run', id: run.id },
      ticks: activity.map((a) => ({ at: Date.parse(a.at), kind: a.kind }))
    })
  }

  // Checks Hydra ran itself: observed, one segment per command.
  for (const e of evidence) {
    const begin = t(e.startedAt)!
    segments.push({
      id: e.id, lane: 'hydra', start: begin, end: begin + e.durationMs, kind: 'check', status: passed(e) ? 'ok' : 'failed', basis: 'observed',
      stage: e.phase === 'verify' ? 'verify' : e.phase === 'pre_review' ? 'review' : 'demo', attempt: 1,
      label: `${e.label} · ${PHASE_NAME[e.phase]}`, ref: { type: 'evidence', id: e.id }, ticks: []
    })
  }

  // Stage outcomes become batons handed to the next lane; agent stages without a run yet are inferred waits.
  const busy = input.slots?.busy ?? 0
  const limit = input.slots?.limit ?? 3
  task.stages.forEach((record, index) => {
    const begin = t(record.startedAt)!
    const finish = t(record.endedAt)
    const next = task.stages[index + 1]
    const lane = AGENT_STAGES[record.stage]
    const runInRecord = runs.some((r) => r.stage === record.stage && t(r.startedAt)! >= begin - 1 && (finish === null || t(r.startedAt)! <= finish))

    if (record.status === 'running' && lane && !runInRecord) {
      // Review first runs Hydra's checks; other agent stages are waiting for their agent to start.
      if (record.stage === 'review' && busy < limit) segments.push(checking(record, begin, 'Running your checks before review'))
      else segments.push({ id: `wait-${record.stage}-${record.attempt}`, lane, start: begin, end: null, kind: 'wait', status: 'waiting', basis: 'inferred', stage: record.stage, attempt: record.attempt,
        label: busy >= limit ? `Waiting for a free agent slot (${busy}/${limit} in use)` : 'Starting the agent', ref: { type: 'stage', stage: record.stage, attempt: record.attempt }, ticks: [] })
    }
    if (record.status === 'running' && (record.stage === 'verify' || record.stage === 'demo')) {
      const lastCheck = evidence.filter((e) => t(e.startedAt)! >= begin).map((e) => t(e.startedAt)! + e.durationMs).reduce((a, b) => Math.max(a, b), begin)
      segments.push(checking(record, lastCheck, record.stage === 'verify' ? 'Running your checks on the result' : 'Running checks on the original commit and the result'))
    }
    if (record.stage === 'apply') {
      segments.push({ id: `apply-${record.attempt}`, lane: 'hydra', start: begin, end: finish, kind: 'apply', status: statusOf(record.status), basis: 'observed', stage: 'apply', attempt: record.attempt,
        label: record.status === 'succeeded' ? 'Applied to your branch' : record.status === 'running' ? 'Applying to your branch' : 'Apply stopped', ref: { type: 'stage', stage: 'apply', attempt: record.attempt }, ticks: [] })
    }
    if (finish === null || record.status !== 'succeeded') return
    const note = record.note ?? ''
    const ref: Segment['ref'] = { type: 'stage', stage: record.stage, attempt: record.attempt }
    switch (record.stage) {
      case 'plan':
        if (!change) batons.push({ id: `answer-${record.attempt}`, lane: 'planner', at: finish, to: 'you', label: 'Answer', tone: 'ok', kind: 'answer', basis: 'observed', ref })
        else batons.push({ id: `plan-${record.attempt}`, lane: 'planner', at: finish, to: next?.stage === 'implement' ? 'implementer' : 'you', label: note || 'Plan', tone: 'neutral', kind: 'plan', basis: 'observed', ref })
        break
      case 'implement':
      case 'fix':
        batons.push({ id: `changes-${record.stage}-${record.attempt}`, lane: 'implementer', at: finish, to: 'reviewer', label: note ? note.replace(/^Commit /, 'Commit ') : 'Changes', tone: 'neutral', kind: 'changes', basis: 'observed', ref })
        break
      case 'review': {
        const approved = /^Approved/.test(note)
        const requested = /^Changes requested/.test(note)
        batons.push({ id: `review-${record.attempt}`, lane: 'reviewer', at: finish, to: next?.stage === 'fix' ? 'implementer' : 'hydra', label: note || 'Reviewed',
          tone: approved ? 'ok' : requested ? 'bad' : 'neutral', kind: next?.stage === 'fix' ? 'repair' : 'review', basis: 'observed', ref })
        break
      }
      case 'verify': {
        const failed = /failed/.test(note)
        const unverified = /unverified/.test(note) || !task.checks.length
        batons.push({ id: `verify-${record.attempt}`, lane: 'hydra', at: finish, to: next?.stage === 'fix' ? 'implementer' : null, label: note || (unverified ? 'Not verified: no checks' : 'Checks done'),
          tone: failed ? 'bad' : unverified ? 'you' : 'ok', kind: next?.stage === 'fix' ? 'repair' : 'checks', basis: 'observed', ref })
        break
      }
      case 'demo':
        batons.push({ id: `demo-${record.attempt}`, lane: 'hydra', at: finish, to: 'you', label: note || 'Before → after', tone: 'accent', kind: 'demo', basis: 'observed', ref })
        break
      default:
    }
  })

  // Your gates: waiting for a decision (observed while waiting; reconstructed from stage times afterwards).
  for (const gate of gates(task, now)) segments.push(gate)
  for (const f of task.feedback) {
    batons.push({ id: `feedback-${f.at}`, lane: 'you', at: Date.parse(f.at), to: 'implementer', label: 'Your feedback', tone: 'you', kind: 'decision', basis: 'observed', ref: null })
  }
  const decided = decision(task)
  if (decided) batons.push(decided)

  const lastMoment = Math.max(start + 1000, ...segments.map((s) => s.end ?? now), ...batons.map((b) => b.at), live ? now : 0)
  return {
    start, end: domainEnd(start, lastMoment, live), now, live, lanes, segments, batons, stages,
    headline: headline(input, runs, evidence, busy, limit, name),
    repairRounds: task.stages.filter((s) => s.stage === 'fix').length
  }
}

function checking(record: Task['stages'][number], from: number, label: string): Segment {
  return { id: `checking-${record.stage}-${record.attempt}`, lane: 'hydra', start: from, end: null, kind: 'checking', status: 'running', basis: 'inferred', stage: record.stage, attempt: record.attempt,
    label, ref: { type: 'stage', stage: record.stage, attempt: record.attempt }, ticks: [] }
}

function statusOf(status: Task['stages'][number]['status']): SegStatus {
  return status === 'succeeded' ? 'ok' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : status === 'canceled' ? 'canceled' : 'interrupted'
}

/** Periods spent waiting for you. */
function gates(task: Task, now: number): Segment[] {
  const out: Segment[] = []
  const stages = task.stages
  stages.forEach((record, index) => {
    const finish = t(record.endedAt)
    if (finish === null) return
    const next = stages[index + 1]
    const planGate = record.stage === 'plan' && record.status === 'succeeded' && task.intent === 'change'
    const finalGate = record.stage === 'demo' && record.status === 'succeeded'
    if (!planGate && !finalGate) return
    const reason = planGate ? 'plan_approval' as const : 'final_approval' as const
    const waitingNow = !next && task.status === 'waiting_input' && task.waitReason === reason
    // After plan approval the next stage starts within a moment unless someone had to decide.
    const until = next ? t(next.startedAt)! : waitingNow ? null : task.status === 'completed' ? t(task.updatedAt)! : null
    if (!waitingNow && until !== null && until - finish < 1500) return
    if (!waitingNow && until === null) return
    out.push({ id: `gate-${reason}-${record.attempt}`, lane: 'you', start: finish, end: until, kind: 'gate', status: waitingNow ? 'waiting' : 'ok',
      basis: waitingNow ? 'observed' : 'inferred', stage: reason === 'plan_approval' ? 'plan' : 'approval', attempt: record.attempt,
      label: reason === 'plan_approval' ? (waitingNow ? 'Waiting for you: approve the plan' : 'You approved the plan') : (waitingNow ? 'Waiting for you: review the result' : 'Your review'),
      ref: { type: 'gate', reason }, ticks: [] })
  })
  void now
  return out
}

function decision(task: Task): Baton | null {
  if (task.status !== 'completed' || !task.outcome || task.intent !== 'change') return null
  const at = Date.parse(task.updatedAt)
  const label = { applied: 'Accepted and applied', discarded: 'Rejected', kept_branch: 'Kept the branch', rolled_back: 'Rolled back', answered: 'Answered' }[task.outcome]
  return { id: 'decision', lane: 'you', at, to: null, label, tone: task.outcome === 'applied' ? 'ok' : 'neutral', kind: 'decision', basis: 'observed', ref: null }
}

/** Past tense: a reported call may already be over (Codex reports commands once they finish). */
export const DID: Record<RunActivity['kind'], string> = { read: 'read', search: 'searched', edit: 'edited', command: 'ran', other: 'used' }

/** One plain sentence: what is happening right now, or how it ended. */
function headline(input: TraceInput, runs: AgentRunInfo[], evidence: Evidence[], busy: number, limit: number, name: (id: ProviderId) => string): Headline {
  const { task } = input
  if (task.status === 'waiting_input') {
    if (task.waitReason === 'plan_approval') return { text: 'Waiting for you: approve the plan and the check commands', tone: 'you', basis: 'observed' }
    if (task.waitReason === 'final_approval') {
      // Say what verification actually established, from the last verify round.
      const verify = [...task.stages].reverse().find((s) => s.stage === 'verify')
      const note = verify?.note ?? ''
      const what = !task.checks.length || /unverified/.test(note) ? 'the result (not verified: no checks)' : /failed/.test(note) ? `the result: ${note.toLowerCase()}` : verify ? 'the verified result' : 'the result'
      return { text: `Waiting for you: review ${what}`, tone: 'you', basis: 'observed' }
    }
    return { text: 'Waiting for you', tone: 'you', basis: 'observed' }
  }
  if (task.status === 'queued') return { text: 'Queued: starting shortly', tone: 'neutral', basis: 'observed' }
  if (task.status === 'running') {
    const run = runs.filter((r) => r.status === 'running').at(-1)
    if (run) {
      const activity = (input.liveActivity?.[run.id] ?? run.activity ?? []).at(-1)
      const who = name(run.provider)
      const last = activity ? { text: `${DID[activity.kind]} ${shortTarget(activity.target)}`, at: Date.parse(activity.at) } : undefined
      const doing = { plan: task.intent === 'analyze' ? 'working on the answer' : 'planning the change', implement: 'implementing the plan', fix: `repairing (round ${task.fixRound})`, review: 'reviewing the change', verify: 'working', demo: 'working', approval: 'working', apply: 'working' }[run.stage]
      return { text: `${who} is ${doing}`, tone: 'accent', basis: 'observed', last }
    }
    if (task.stage === 'verify' || task.stage === 'demo' || task.stage === 'review') {
      const since = task.stages.at(-1)
      const done = since ? evidence.filter((e) => e.startedAt >= since.startedAt).length : 0
      if (task.stage !== 'review' || busy < limit) return { text: `Hydra is running your checks${done ? ` (${done} done)` : ''}`, tone: 'accent', basis: 'inferred' }
    }
    if (task.stage === 'apply') return { text: 'Hydra is applying the accepted commit to your branch', tone: 'accent', basis: 'observed' }
    if (busy >= limit) return { text: `Waiting for a free agent slot (${busy} of ${limit} in use by other tasks)`, tone: 'neutral', basis: 'inferred' }
    return { text: 'Starting the next agent', tone: 'neutral', basis: 'inferred' }
  }
  if (task.status === 'paused') return { text: 'Paused: completed stages are kept; resume to continue', tone: 'neutral', basis: 'observed' }
  if (task.status === 'failed') return { text: `Stopped: ${(task.error ?? 'failed').split('\n')[0]!.slice(0, 160)}`, tone: 'bad', basis: 'observed' }
  if (task.status === 'canceled') return { text: 'Canceled', tone: 'neutral', basis: 'observed' }
  const outcome = {
    applied: `Applied to ${task.applied?.targetBranch ?? 'your branch'} at ${task.applied?.afterSha.slice(0, 8) ?? ''}`.trim(),
    discarded: 'Rejected: nothing was written to your branch',
    kept_branch: `Kept on branch ${task.workspace?.branch ?? ''}`.trim(),
    answered: 'Answered',
    rolled_back: 'Applied, then rolled back with a revert commit'
  }[task.outcome ?? 'answered']
  return { text: outcome, tone: task.outcome === 'applied' || task.outcome === 'answered' ? 'ok' : 'neutral', basis: 'observed' }
}

/** Keeps the end of a long path or command, where the meaningful part is. */
export function shortTarget(target: string, max = 64): string {
  const clean = target.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `…${clean.slice(-max)}` : clean
}

/** Files an agent touched, from its tool calls: inspected and modified, most recent first. */
export function filesOf(activity: RunActivity[]): { inspected: string[]; modified: string[]; commands: string[] } {
  const seen = { inspected: new Set<string>(), modified: new Set<string>(), commands: new Set<string>() }
  for (const a of [...activity].reverse()) {
    if (a.kind === 'edit') for (const path of a.target.split(/,\s*/).filter(Boolean)) seen.modified.add(path)
    else if (a.kind === 'read') seen.inspected.add(a.target)
    else if (a.kind === 'command') seen.commands.add(a.target)
  }
  return { inspected: [...seen.inspected], modified: [...seen.modified], commands: [...seen.commands] }
}
