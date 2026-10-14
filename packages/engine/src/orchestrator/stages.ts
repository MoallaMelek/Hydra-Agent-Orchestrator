import { z } from 'zod'
import { isHighRisk, Plan, Review, type DemoReport, type Evidence, type Task, type TaskStage } from '@hydra/protocol'
import { isAncestor } from '../isolation/git.js'
import { answerPrompt, fixPrompt, implementPrompt, planPrompt, reviewPrompt, type Turn } from '../prompts/prompts.js'
import { IMPLEMENT_SCHEMA, PLAN_SCHEMA, REVIEW_SCHEMA } from '../prompts/schemas.js'
import { checkDefinitionDigest } from '../verification/detect.js'
import { checksFor } from '../verification/custom.js'
import { passed } from '../verification/runner.js'
import type { StageResult } from '../workflow/machine.js'
import { conflict } from '../util/errors.js'
import { isoNow } from '../util/ids.js'
import { callAgent, callAgentText } from './agent-runner.js'
import { runChecksAt } from './checks.js'
import { type EngineContext, logTask, updateTask } from './context.js'

/** Planner output: a plan, or (steps empty) a direct reply when the message was not a change request. */
const PlannerOutput = Plan.extend({
  steps: z.array(z.string().min(1).max(1000)).max(30),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).max(20),
  reply: z.string().max(20_000).default('')
})
const ImplementReport = z.object({ summary: z.string(), followUps: z.array(z.string()) })
const MAX_DIFF_CHARS = 120_000

export interface StageInput {
  ctx: EngineContext
  taskId: string
  signal: AbortSignal
}

const task = (ctx: EngineContext, id: string): Task => ctx.store.getTask(id)!
const projectRoot = (ctx: EngineContext, t: Task): string => ctx.store.getProject(t.projectId)!.root

function workspaceOf(t: Task) {
  if (!t.workspace || t.workspace.removed) throw new Error('The task workspace no longer exists')
  return t.workspace
}

async function checkpoint(ctx: EngineContext, taskId: string, message: string): Promise<Task> {
  const ws = await ctx.workspaces.checkpoint(workspaceOf(task(ctx, taskId)), message)
  return updateTask(ctx, taskId, (draft) => { draft.workspace = ws })
}

/** Latest evidence per check for a phase at a SHA (a phase can run more than once). */
export function latestEvidence(all: readonly Evidence[], phase: Evidence['phase'], sha: string): Map<string, Evidence> {
  const latest = new Map<string, Evidence>()
  for (const e of all) if (e.phase === phase && e.commitSha === sha) latest.set(e.checkId, e) // ids are time-ordered
  return latest
}

/** Earlier turns of a follow-up conversation, oldest first (at most four, answers shortened). */
function conversation(ctx: EngineContext, t: Task): Turn[] {
  const turns: Turn[] = []
  let previous = t.followUpOf ? ctx.store.getTask(t.followUpOf) : null
  while (previous && turns.length < 4) {
    if (previous.answer) turns.unshift({ question: previous.prompt.slice(0, 4000), answer: previous.answer.slice(0, 6000) })
    previous = previous.followUpOf ? ctx.store.getTask(previous.followUpOf) : null
  }
  return turns
}

// ── PLAN ─────────────────────────────────────────────────────
export async function planStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  let t = task(ctx, taskId)
  if (t.intent === 'analyze') {
    // One streamed, read-only reply: no plan, no worktree, no review.
    const { text } = await callAgentText(ctx, {
      taskId, stage: 'plan', role: 'planner', provider: t.assignment.planner, access: 'read', cwd: projectRoot(ctx, t),
      prompt: answerPrompt(t, conversation(ctx, t)), stream: true, signal
    })
    updateTask(ctx, taskId, (draft) => { draft.answer = text })
    return { stage: 'plan', ok: true }
  }
  if (!t.workspace) {
    const ws = await ctx.workspaces.create(taskId, projectRoot(ctx, t))
    t = updateTask(ctx, taskId, (draft) => { draft.workspace = ws })
    logTask(ctx, taskId, 'info', `Isolated workspace on branch ${ws.branch} from ${ws.baseSha.slice(0, 10)}`)
  }
  const ws = workspaceOf(t)
  let checks
  try {
    // Your own list (kept in Hydra) wins over .hydra/checks.json and detection.
    checks = checksFor(ctx.store.getProject(t.projectId)!, ws.path).checks
  } catch (error) {
    throw new Error(`.hydra/checks.json is invalid: ${(error as Error).message}`, { cause: error })
  }
  updateTask(ctx, taskId, (draft) => { draft.checks = checks; draft.checkDigest = checkDefinitionDigest(ws.path) })
  logTask(ctx, taskId, checks.length ? 'info' : 'warn', checks.length
    ? `Detected ${checks.length} check(s): ${checks.map((c) => c.label).join(', ')}`
    : 'No build or test commands detected. Add .hydra/checks.json to declare them; without checks Hydra cannot verify behaviour.')
  const { value } = await callAgent(ctx, {
    taskId, stage: 'plan', role: 'planner', provider: t.assignment.planner, access: 'read', cwd: ws.path,
    prompt: planPrompt(task(ctx, taskId)), jsonSchema: PLAN_SCHEMA, parse: PlannerOutput, signal
  })
  if (!value.steps.length) {
    if (!value.reply.trim()) throw new Error('The planner returned neither a plan nor a reply')
    // A question sent as a change: answer it, drop the unused workspace, finish as answered.
    const discarded = await ctx.workspaces.discard(projectRoot(ctx, t), ws)
    updateTask(ctx, taskId, (draft) => { draft.intent = 'analyze'; draft.answer = value.reply; draft.workspace = discarded; draft.checks = [] })
    logTask(ctx, taskId, 'info', 'This was a question rather than a change, so Hydra answered it and made no changes.')
    return { stage: 'plan', ok: true }
  }
  const { reply: _reply, ...plan } = value
  // Second line of defence: judge the plan itself, not only how the request was worded.
  // Each step on its own: words from different steps must not combine into a false alarm.
  const escalate = [plan.summary, ...plan.steps, ...plan.filesLikelyTouched].some((line) => isHighRisk(line)) && task(ctx, taskId).route?.risk !== 'high'
  updateTask(ctx, taskId, (draft) => {
    draft.plan = Plan.parse(plan)
    if (escalate) draft.route = { depth: 'deep', auto: draft.route?.auto ?? false, risk: 'high', reason: 'The plan includes a risky operation, so it needs your approval first.' }
  })
  if (escalate) logTask(ctx, taskId, 'warn', 'The plan includes a risky operation (deleting data, secrets, production or similar). Hydra is waiting for your approval before any code is written.')
  return { stage: 'plan', ok: true }
}

// ── IMPLEMENT / FIX ──────────────────────────────────────────
export async function implementStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  const t = task(ctx, taskId)
  const ws = workspaceOf(t)
  const { value } = await callAgent(ctx, {
    taskId, stage: 'implement', role: 'implementer', provider: t.assignment.implementer, access: 'write', cwd: ws.path,
    prompt: implementPrompt(t), jsonSchema: IMPLEMENT_SCHEMA, parse: ImplementReport, signal
  })
  const after = await checkpoint(ctx, taskId, `hydra: implement (${t.assignment.implementer})`)
  if (after.workspace!.headSha === ws.baseSha) return { stage: 'implement', ok: false, error: 'The implementer made no changes' }
  logTask(ctx, taskId, 'info', `Implementer: ${value.summary.slice(0, 1500)}`)
  return { stage: 'implement', ok: true }
}

export async function fixStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  const previous = task(ctx, taskId)
  const lastFix = [...previous.stages].reverse().find((s) => s.stage === 'fix' && s.status !== 'running')
  const before = updateTask(ctx, taskId, (draft) => { draft.fixRound += 1 })
  const ws = workspaceOf(before)
  const human = before.feedback.filter((f) => !lastFix || f.at > lastFix.startedAt).map((f) => f.text).join('\n\n') || null
  const head = ws.headSha ?? ws.baseSha
  const all = ctx.store.listEvidence(taskId)
  const failing = [...latestEvidence(all, 'verify', head).values(), ...latestEvidence(all, 'pre_review', head).values()].filter((e) => !passed(e))
  const { value } = await callAgent(ctx, {
    taskId, stage: 'fix', role: 'implementer', provider: before.assignment.implementer, access: 'write', cwd: ws.path,
    prompt: fixPrompt(before, before.review?.findings ?? [], failing, human), jsonSchema: IMPLEMENT_SCHEMA, parse: ImplementReport, signal
  })
  await checkpoint(ctx, taskId, `hydra: fix round ${before.fixRound} (${before.assignment.implementer})`)
  logTask(ctx, taskId, 'info', `Fix round ${before.fixRound}: ${value.summary.slice(0, 1500)}`)
  return { stage: 'fix', ok: true }
}

// ── REVIEW ───────────────────────────────────────────────────
export async function reviewStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  const t = task(ctx, taskId)
  const ws = workspaceOf(t)
  const evidence = await runChecksAt(ctx, t, ws.headSha ?? ws.baseSha, 'pre_review', signal)
  const { files } = await ctx.workspaces.diff(ws)
  let diff = files.map((f) => f.patch || `(${f.status}) ${f.path}`).join('\n')
  if (diff.length > MAX_DIFF_CHARS) diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated; read the files directly for the rest.`
  if (t.assignment.reviewer === t.assignment.implementer) {
    logTask(ctx, taskId, 'warn', 'Reviewer and implementer use the same provider; the review is a fresh session but not provider-independent.')
  }
  const { value } = await callAgent(ctx, {
    taskId, stage: 'review', role: 'reviewer', provider: t.assignment.reviewer, access: 'read', cwd: ws.path,
    prompt: reviewPrompt(t, diff, evidence), jsonSchema: REVIEW_SCHEMA, parse: Review, signal
  })
  const blocking = value.findings.filter((f) => f.severity === 'blocker' || f.severity === 'major').length
  updateTask(ctx, taskId, (draft) => { draft.review = value })
  return { stage: 'review', ok: true, approved: value.verdict === 'approve' && blocking === 0 }
}

// ── VERIFY ───────────────────────────────────────────────────
export async function verifyStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  const t = task(ctx, taskId)
  const ws = workspaceOf(t)
  if (!t.checks.length) {
    logTask(ctx, taskId, 'warn', 'Verification skipped: no checks are defined for this project. The result is unverified.')
    return { stage: 'verify', ok: true, requiredFailures: 0 }
  }
  const head = ws.headSha ?? ws.baseSha
  const evidence = await runChecksAt(ctx, t, head, 'verify', signal)
  if (signal.aborted) return { stage: 'verify', ok: false, error: 'Canceled' }
  const requiredFailures = evidence.filter((e) => e.required && !passed(e)).length
  logTask(ctx, taskId, requiredFailures ? 'warn' : 'info', `Verification at ${head.slice(0, 10)}: ${evidence.filter(passed).length}/${evidence.length} checks passed`)
  return { stage: 'verify', ok: true, requiredFailures }
}

// ── DEMO ─────────────────────────────────────────────────────
type Outcome = DemoReport['deltas'][number]['before']
const outcomeOf = (e: Evidence | undefined): Outcome => (!e ? 'missing' : e.spawnError || e.timedOut || e.treeMutated ? 'error' : e.exitCode === 0 ? 'pass' : 'fail')

/** Runs the same checks on the original commit to show what the change actually changed. */
export async function demoStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  const t = task(ctx, taskId)
  const ws = workspaceOf(t)
  const finalSha = ws.headSha ?? ws.baseSha
  if (!t.checks.length) {
    updateTask(ctx, taskId, (draft) => { draft.demo = { baseSha: ws.baseSha, finalSha, deltas: [], narrative: 'No automated checks exist for this project, so no behavioural before/after comparison is possible. Review the diff carefully.' } })
    return { stage: 'demo', ok: true }
  }
  // The base run uses the plan-time definitions (the agent cannot have changed them at base).
  const baseEvidence = await runChecksAt(ctx, { ...t, checkDigest: null }, ws.baseSha, 'demo_base', signal)
  const finalEvidence = latestEvidence(ctx.store.listEvidence(taskId), 'verify', finalSha)
  const deltas = t.checks.map((check) => ({
    checkId: check.id, label: check.label,
    before: outcomeOf(baseEvidence.find((e) => e.checkId === check.id)),
    after: outcomeOf(finalEvidence.get(check.id))
  }))
  const fixed = deltas.filter((d) => d.before !== 'pass' && d.after === 'pass')
  const broken = deltas.filter((d) => d.before === 'pass' && d.after !== 'pass')
  const narrative = [
    fixed.length ? `Now passing (were not before): ${fixed.map((d) => d.label).join(', ')}.` : 'No check changed from failing to passing.',
    broken.length ? `REGRESSIONS (passed before, not now): ${broken.map((d) => d.label).join(', ')}.` : 'No regressions among detected checks.'
  ].join(' ')
  updateTask(ctx, taskId, (draft) => { draft.demo = { baseSha: ws.baseSha, finalSha, deltas, narrative } })
  return { stage: 'demo', ok: true }
}

// ── APPLY ────────────────────────────────────────────────────
/** Raised when integration changed the commit under review; the human must look again. */
export class ReapprovalNeeded extends Error {}

/**
 * Apply is a fast-forward of the exact approved SHA. If the user's branch moved,
 * Hydra integrates it into the task branch, re-verifies, and asks for a fresh
 * decision on the new commit instead of applying something nobody reviewed.
 * Not cancelable once it starts mutating the user's branch.
 */
export async function applyStage({ ctx, taskId }: StageInput): Promise<StageResult> {
  let t = task(ctx, taskId)
  let ws = workspaceOf(t)
  const root = projectRoot(ctx, t)
  const approved = ws.headSha ?? ws.baseSha
  const target = await ctx.workspaces.target(root)

  if (target.head !== ws.baseSha && !(await isAncestor(root, target.head, approved))) {
    ws = await ctx.workspaces.integrate(ws, target.head)
    t = updateTask(ctx, taskId, (draft) => { draft.workspace = ws })
    logTask(ctx, taskId, 'info', `Your branch moved; integrated ${target.head.slice(0, 10)} into the task branch and re-verifying.`)
    const evidence = await runChecksAt(ctx, t, ws.headSha!, 'verify', new AbortController().signal)
    const failures = evidence.filter((e) => e.required && !passed(e)).length
    throw new ReapprovalNeeded(failures
      ? `After integrating your newer commits, ${failures} required check(s) fail. Review the new result before accepting.`
      : 'Your branch had newer commits. Hydra integrated them and all checks pass. Review the updated result and accept again.')
  }

  updateTask(ctx, taskId, (draft) => { draft.applyIntent = { targetBranch: target.branch, beforeSha: target.head, approvedSha: approved, startedAt: isoNow() } })
  const applied = await ctx.workspaces.apply(root, approved, target.head !== ws.baseSha ? approved : null)
  updateTask(ctx, taskId, (draft) => { draft.applied = applied; draft.applyIntent = null })
  logTask(ctx, taskId, 'info', applied.method === 'none'
    ? 'Nothing new to apply: your branch already contains this change.'
    : `Applied to ${applied.targetBranch} by fast-forward: ${applied.beforeSha.slice(0, 10)} → ${applied.afterSha.slice(0, 10)}`)
  try {
    const released = await ctx.workspaces.discard(root, ws)
    updateTask(ctx, taskId, (draft) => { draft.workspace = released })
  } catch (error) {
    logTask(ctx, taskId, 'warn', `Applied, but cleaning up the worktree failed: ${(error as Error).message}`)
  }
  return { stage: 'apply', ok: true }
}

export function assertNotApplying(t: Task): void {
  if (t.stage === 'apply' && t.status === 'running') throw conflict('The change is being applied to your branch; wait for it to finish.')
}

export const STAGE_RUNNERS: Partial<Record<TaskStage, (input: StageInput) => Promise<StageResult>>> = {
  plan: planStage,
  implement: implementStage,
  review: reviewStage,
  fix: fixStage,
  verify: verifyStage,
  demo: demoStage,
  apply: applyStage
}
