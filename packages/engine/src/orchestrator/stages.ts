import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Plan, Review, type DemoReport, type Evidence, type Task, type TaskStage } from '@hydra/protocol'
import { git, removeWorktree } from '../isolation/git.js'
import { linkDependencies, unlinkDependencies } from '../isolation/workspace.js'
import { answerPrompt, fixPrompt, implementPrompt, planPrompt, reviewPrompt } from '../prompts/prompts.js'
import { ANSWER_SCHEMA, IMPLEMENT_SCHEMA, PLAN_SCHEMA, REVIEW_SCHEMA } from '../prompts/schemas.js'
import { detectChecks } from '../verification/detect.js'
import { passed, runChecks } from '../verification/runner.js'
import type { StageResult } from '../workflow/machine.js'
import { newId } from '../util/ids.js'
import { callAgent } from './agent-runner.js'
import { type EngineContext, logTask, updateTask } from './context.js'

const Answer = z.object({ answer: z.string().min(1), keyFindings: z.array(z.string()), filesReferenced: z.array(z.string()) })
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
  const t = task(ctx, taskId)
  const ws = await ctx.workspaces.checkpoint(workspaceOf(t), message)
  return updateTask(ctx, taskId, (draft) => { draft.workspace = ws })
}

async function execChecks(ctx: EngineContext, t: Task, phase: Evidence['phase'], cwd: string, sha: string, signal: AbortSignal): Promise<Evidence[]> {
  if (!t.checks.length) return []
  return runChecks(t.checks, {
    taskId: t.id, workspacePath: cwd, commitSha: sha, phase,
    logsDir: join(ctx.paths.logs, t.id), scratchDir: join(ctx.paths.scratch, t.id, phase), signal,
    env: ctx.env, onEvidence: (evidence) => ctx.store.putEvidence(evidence)
  })
}

// ── PLAN ─────────────────────────────────────────────────────
export async function planStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  let t = task(ctx, taskId)
  if (t.intent === 'analyze') {
    const { value } = await callAgent(ctx, {
      taskId, stage: 'plan', role: 'planner', provider: t.assignment.planner, access: 'read', cwd: projectRoot(ctx, t),
      prompt: answerPrompt(t), jsonSchema: ANSWER_SCHEMA, parse: Answer, signal
    })
    const findings = value.keyFindings.length ? `\n\n**Key findings**\n${value.keyFindings.map((f) => `- ${f}`).join('\n')}` : ''
    updateTask(ctx, taskId, (draft) => { draft.answer = `${value.answer}${findings}` })
    return { stage: 'plan', ok: true }
  }
  if (!t.workspace) {
    const ws = await ctx.workspaces.create(taskId, projectRoot(ctx, t))
    t = updateTask(ctx, taskId, (draft) => { draft.workspace = ws })
    logTask(ctx, taskId, 'info', `Isolated workspace created on branch ${ws.branch} from ${ws.baseSha.slice(0, 10)}`)
  }
  const ws = workspaceOf(t)
  let checks
  try {
    checks = detectChecks(ws.path)
  } catch (error) {
    throw new Error(`.hydra/checks.json is invalid: ${(error as Error).message}`, { cause: error })
  }
  updateTask(ctx, taskId, (draft) => { draft.checks = checks })
  logTask(ctx, taskId, checks.length ? 'info' : 'warn', checks.length
    ? `Detected ${checks.length} check(s): ${checks.map((c) => c.label).join(', ')}`
    : 'No build or test commands detected. Add .hydra/checks.json to declare them; without checks Hydra cannot verify behaviour.')
  const { value } = await callAgent(ctx, {
    taskId, stage: 'plan', role: 'planner', provider: t.assignment.planner, access: 'read', cwd: ws.path,
    prompt: planPrompt(task(ctx, taskId)), jsonSchema: PLAN_SCHEMA, parse: Plan, signal
  })
  updateTask(ctx, taskId, (draft) => { draft.plan = value })
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
  const before = updateTask(ctx, taskId, (draft) => { draft.fixRound += 1 })
  const ws = workspaceOf(before)
  const lastFix = [...before.stages].reverse().find((s) => s.stage === 'fix' && s.status !== 'running')
  const human = before.feedback.filter((f) => !lastFix || f.at > lastFix.startedAt).map((f) => f.text).join('\n\n') || null
  const evidence = ctx.store.listEvidence(taskId).filter((e) => (e.phase === 'verify' || e.phase === 'pre_review') && e.commitSha === ws.headSha && !passed(e))
  const { value } = await callAgent(ctx, {
    taskId, stage: 'fix', role: 'implementer', provider: before.assignment.implementer, access: 'write', cwd: ws.path,
    prompt: fixPrompt(before, before.review?.findings ?? [], evidence, human), jsonSchema: IMPLEMENT_SCHEMA, parse: ImplementReport, signal
  })
  await checkpoint(ctx, taskId, `hydra: fix round ${before.fixRound} (${before.assignment.implementer})`)
  logTask(ctx, taskId, 'info', `Fix round ${before.fixRound}: ${value.summary.slice(0, 1500)}`)
  return { stage: 'fix', ok: true }
}

// ── REVIEW ───────────────────────────────────────────────────
export async function reviewStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  const t = task(ctx, taskId)
  const ws = workspaceOf(t)
  const head = ws.headSha ?? ws.baseSha
  const evidence = await execChecks(ctx, t, 'pre_review', ws.path, head, signal)
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
  const evidence = await execChecks(ctx, t, 'verify', ws.path, ws.headSha ?? ws.baseSha, signal)
  if (signal.aborted) return { stage: 'verify', ok: false, error: 'Canceled' }
  const requiredFailures = evidence.filter((e) => e.required && !passed(e)).length
  logTask(ctx, taskId, requiredFailures ? 'warn' : 'info', `Verification at ${(ws.headSha ?? '').slice(0, 10)}: ${evidence.filter(passed).length}/${evidence.length} checks passed`)
  return { stage: 'verify', ok: true, requiredFailures }
}

// ── DEMO ─────────────────────────────────────────────────────
type Outcome = DemoReport['deltas'][number]['before']
const outcomeOf = (e: Evidence | undefined): Outcome => (!e ? 'missing' : e.spawnError || e.timedOut ? 'error' : e.exitCode === 0 ? 'pass' : 'fail')

/** Runs the same checks on the original commit to show what the change actually changed. */
export async function demoStage({ ctx, taskId, signal }: StageInput): Promise<StageResult> {
  const t = task(ctx, taskId)
  const ws = workspaceOf(t)
  const finalSha = ws.headSha ?? ws.baseSha
  const finalEvidence = ctx.store.listEvidence(taskId).filter((e) => e.phase === 'verify' && e.commitSha === finalSha)
  if (!t.checks.length) {
    updateTask(ctx, taskId, (draft) => { draft.demo = { baseSha: ws.baseSha, finalSha, deltas: [], narrative: 'No automated checks exist for this project, so no behavioural before/after comparison is possible. Review the diff carefully.' } })
    return { stage: 'demo', ok: true }
  }
  const root = projectRoot(ctx, t)
  const baseTree = join(ctx.paths.scratch, t.id, `demo-base-${newId()}`)
  let baseEvidence: Evidence[] = []
  try {
    await git(root, ['worktree', 'add', '--detach', baseTree, ws.baseSha])
    linkDependencies(root, baseTree)
    baseEvidence = await execChecks(ctx, t, 'demo_base', baseTree, ws.baseSha, signal)
  } finally {
    unlinkDependencies(baseTree)
    await removeWorktree(root, baseTree)
    rmSync(baseTree, { recursive: true, force: true })
  }
  const deltas = t.checks.map((check) => ({
    checkId: check.id, label: check.label,
    before: outcomeOf(baseEvidence.find((e) => e.checkId === check.id)),
    after: outcomeOf(finalEvidence.find((e) => e.checkId === check.id))
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
export async function applyStage({ ctx, taskId }: StageInput): Promise<StageResult> {
  const t = task(ctx, taskId)
  const ws = workspaceOf(t)
  const root = projectRoot(ctx, t)
  const applied = await ctx.workspaces.apply(root, ws, ws.headSha ?? ws.baseSha, `${t.title} (${t.id.slice(-8)})`)
  const released = await ctx.workspaces.discard(root, ws)
  updateTask(ctx, taskId, (draft) => { draft.applied = applied; draft.workspace = released })
  logTask(ctx, taskId, 'info', `Applied to ${applied.targetBranch} by ${applied.method === 'fast_forward' ? 'fast-forward' : 'merge'}: ${applied.beforeSha.slice(0, 10)} → ${applied.afterSha.slice(0, 10)}`)
  return { stage: 'apply', ok: true }
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
