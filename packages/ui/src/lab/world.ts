import type { AgentRunInfo, Evidence, EventEnvelope, EngineEvent, Plan, Project, ProviderId, ProviderStatus, Review, Task, TaskStage } from '@hydra/protocol'

/**
 * SIMULATED FIXTURE DATA — for development, tests and benchmarks only.
 *
 * A small in-memory stand-in for the engine that produces events with exactly the
 * shapes the real engine publishes. Nothing here is real agent activity; the lab page
 * says so on screen.
 */

let counter = 0
export const fixtureId = (prefix: string) => `${prefix}${(++counter).toString(36).padStart(6, '0')}fixture`.slice(0, 26)

const SHA = (n: number) => (n.toString(16).padStart(8, '0').repeat(5)).slice(0, 40)
const usage = (input = 0, output = 0, cost = 0) => ({ inputTokens: input, outputTokens: output, cachedTokens: 0, costUsd: cost, unpricedTokens: 0, agentRuns: 0 })

export const FIXTURE_PROVIDERS: ProviderStatus[] = [
  { id: 'claude', displayName: 'Claude Code', installed: true, path: 'claude', version: 'fixture', authenticated: true, authMethod: 'fixture', capabilities: { structuredOutput: true, osSandbox: false, fileToolConfinement: true, reportsUsage: true, reportsCost: true }, problems: [] },
  { id: 'codex', displayName: 'Codex CLI', installed: true, path: 'codex', version: 'fixture', authenticated: true, authMethod: 'fixture', capabilities: { structuredOutput: true, osSandbox: true, fileToolConfinement: false, reportsUsage: true, reportsCost: false }, problems: [] }
]

export class FixtureWorld {
  seq = 0
  /** Simulated wall clock (ms since epoch); advanced by the player. */
  now = Date.parse('2026-10-16T09:00:00Z')
  readonly projects: Project[] = []
  readonly tasks = new Map<string, Task>()
  readonly runs = new Map<string, AgentRunInfo>()
  readonly evidence: Evidence[] = []
  private readonly listeners = new Set<(e: EventEnvelope) => void>()
  /** Mirrors the engine's agent-slot semaphore: a run starts only when a slot is free. */
  slots = 3
  private inUse = 0
  private readonly waiting: Array<() => void> = []

  async acquireSlot(): Promise<() => void> {
    if (this.inUse >= this.slots) await new Promise<void>((go) => this.waiting.push(go))
    else this.inUse++
    return () => { const next = this.waiting.shift(); if (next) next(); else this.inUse-- }
  }

  iso(offsetMs = 0): string { return new Date(this.now + offsetMs).toISOString() }

  on(listener: (e: EventEnvelope) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish(event: EngineEvent): void {
    const envelope: EventEnvelope = { seq: event.type === 'run.output' ? this.seq : ++this.seq, at: this.iso(), event }
    for (const listener of this.listeners) listener(envelope)
  }

  addProject(name: string): Project {
    const project: Project = { id: fixtureId('p'), name, root: `C:/fixtures/${name}`, isGit: true, addedAt: this.iso(), checks: null }
    this.projects.push(project)
    return project
  }

  createTask(projectId: string, prompt: string, opts: Partial<Task> = {}): Task {
    const task: Task = {
      id: fixtureId('t'), projectId, title: prompt.slice(0, 80), prompt, intent: 'change',
      route: { depth: 'deep', auto: true, risk: 'normal', reason: 'Asks for a code change.' },
      followUpOf: null, archivedAt: null, mode: 'developer',
      assignment: { planner: 'claude', implementer: 'codex', reviewer: 'claude' },
      selection: null,
      budget: { maxCostUsd: 5, maxTokens: 2_000_000, maxWallMinutes: 60, maxAgentRuns: 20, maxFixRounds: 2 },
      status: 'queued', stage: 'plan', waitReason: null, outcome: null, fixRound: 0, plan: null, review: null,
      checks: [
        { id: 'node:test', ecosystem: 'node', kind: 'test', label: 'npm test', argv: ['npm', 'test'], cwd: '.', timeoutSec: 600, required: true },
        { id: 'node:typecheck', ecosystem: 'node', kind: 'typecheck', label: 'npm run typecheck', argv: ['npm', 'run', 'typecheck'], cwd: '.', timeoutSec: 600, required: true }
      ],
      checksApproved: false, checkDigest: null, applyIntent: null, demo: null, answer: null,
      workspace: null, applied: null, usage: usage(), stages: [], feedback: [], error: null,
      createdAt: this.iso(), updatedAt: this.iso(), ...opts
    } as Task
    this.tasks.set(task.id, task)
    this.publish({ type: 'task.updated', task })
    return task
  }

  update(taskId: string, mutate: (t: Task) => void): Task {
    const task = structuredClone(this.tasks.get(taskId)!)
    mutate(task)
    task.updatedAt = this.iso()
    this.tasks.set(taskId, task)
    this.publish({ type: 'task.updated', task })
    return task
  }

  log(taskId: string, level: 'info' | 'warn' | 'error', message: string): void {
    this.publish({ type: 'task.log', taskId, level, message })
  }

  beginStage(taskId: string, stage: TaskStage): void {
    this.update(taskId, (t) => {
      const attempt = t.stages.filter((s) => s.stage === stage).length + 1
      t.stage = stage
      t.status = 'running'
      t.waitReason = null
      t.stages.push({ stage, attempt, status: 'running', startedAt: this.iso(), endedAt: null, note: null })
      if (stage === 'implement' && !t.workspace) t.workspace = { path: 'C:/fixtures/worktree', gitDir: 'C:/fixtures/.git/worktrees/x', branch: `hydra/${t.id.slice(-8)}`, baseSha: SHA(1), headSha: SHA(1), removed: false }
      if (stage === 'fix') t.fixRound += 1
    })
  }

  endStage(taskId: string, status: 'succeeded' | 'failed' = 'succeeded', note: string | null = null): void {
    this.update(taskId, (t) => {
      const record = [...t.stages].reverse().find((s) => s.status === 'running')
      if (record) { record.status = status; record.endedAt = this.iso(); record.note = note }
    })
  }

  startRun(taskId: string, stage: TaskStage, role: AgentRunInfo['role'], provider: ProviderId): AgentRunInfo {
    const run: AgentRunInfo = { id: fixtureId('r'), taskId, stage, role, provider, model: provider === 'claude' ? 'claude-fixture' : 'codex-fixture', status: 'running', startedAt: this.iso(), endedAt: null, usage: usage(), error: null, pid: null, tail: '', activity: [] } as AgentRunInfo
    this.runs.set(run.id, run)
    this.update(taskId, (t) => { t.usage.agentRuns += 1 })
    this.publish({ type: 'run.updated', run })
    return run
  }

  /** A tool call as the engine reports it: a live activity event plus the "› name target" output line. */
  tool(runId: string, tool: string, target: string): void {
    const run = this.runs.get(runId)!
    const entry = { at: this.iso(), tool, target, kind: kindOf(tool) }
    run.activity = [...(run.activity ?? []), entry].slice(-200)
    run.tail = (run.tail + `› ${tool} ${target}\n`).slice(-8000)
    this.publish({ type: 'run.activity', runId, taskId: run.taskId, activity: entry })
    this.publish({ type: 'run.output', runId, taskId: run.taskId, text: `› ${tool} ${target}\n` })
  }

  say(runId: string, text: string): void {
    const run = this.runs.get(runId)!
    run.tail = (run.tail + text + '\n').slice(-8000)
    this.publish({ type: 'run.output', runId, taskId: run.taskId, text: `${text}\n` })
  }

  endRun(runId: string, status: AgentRunInfo['status'] = 'succeeded', tokens = 12_000, cost = 0.04, error: string | null = null): void {
    const run = { ...this.runs.get(runId)!, status, endedAt: this.iso(), error }
    run.usage = usage(Math.round(tokens * 0.8), Math.round(tokens * 0.2), run.provider === 'codex' ? 0 : cost)
    if (run.provider === 'codex') run.usage.unpricedTokens = tokens
    this.runs.set(runId, run)
    this.publish({ type: 'run.updated', run })
    this.update(run.taskId, (t) => {
      t.usage.inputTokens += run.usage.inputTokens
      t.usage.outputTokens += run.usage.outputTokens
      t.usage.costUsd += run.usage.costUsd
      t.usage.unpricedTokens += run.usage.unpricedTokens
    })
  }

  check(taskId: string, label: string, phase: Evidence['phase'], exitCode: number, durationMs: number, output = ''): void {
    const task = this.tasks.get(taskId)!
    const evidence: Evidence = {
      id: fixtureId('e'), taskId, checkId: label.includes('type') ? 'node:typecheck' : 'node:test', label, phase,
      commitSha: task.workspace?.headSha ?? SHA(1), argv: label.split(' '), cwd: '.', startedAt: this.iso(-durationMs), durationMs,
      exitCode, timedOut: false, spawnError: null, outputTail: output || (exitCode === 0 ? 'ok — simulated fixture output' : 'FAIL — simulated fixture output'),
      outputBytes: 120, outputSha256: 'a'.repeat(64), outputTruncated: false, treeMutated: false, required: true
    }
    this.evidence.push(evidence)
    this.publish({ type: 'evidence.recorded', evidence })
  }

  commit(taskId: string, n: number): void {
    this.update(taskId, (t) => { if (t.workspace) t.workspace.headSha = SHA(n) })
  }

  setPlan(taskId: string, plan: Plan): void { this.update(taskId, (t) => { t.plan = plan }) }
  setReview(taskId: string, review: Review): void { this.update(taskId, (t) => { t.review = review }) }
}

export function kindOf(tool: string): 'read' | 'search' | 'edit' | 'command' | 'other' {
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read'
  if (/^(Glob|Grep|LS|WebSearch)$/.test(tool)) return 'search'
  if (/^(Edit|Write|MultiEdit|NotebookEdit|edit)$/.test(tool)) return 'edit'
  if (/^(Bash|shell)$/.test(tool)) return 'command'
  return 'other'
}
