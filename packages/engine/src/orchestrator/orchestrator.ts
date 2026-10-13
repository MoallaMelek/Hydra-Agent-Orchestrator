import type { Task, TaskStage } from '@hydra/protocol'
import { afterFinalDecision, afterPlanDecision, nextStep, type FinalDecision, type StageResult, type Step } from '../workflow/machine.js'
import { policyFor } from '../workflow/policy.js'
import { BudgetExceededError, CanceledError, conflict, errorMessage, HydraError, invalid } from '../util/errors.js'
import { isoNow } from '../util/ids.js'
import { type EngineContext, logTask, updateTask } from './context.js'
import { STAGE_RUNNERS } from './stages.js'

const ACTIVE = new Set(['queued', 'running'])

export class Orchestrator {
  private readonly running = new Map<string, AbortController>()
  private readonly done = new Map<string, Promise<void>>()

  constructor(private readonly ctx: EngineContext) {}

  isRunning(taskId: string): boolean {
    return this.running.has(taskId)
  }

  /** Resolves when the task's current drive loop ends (tests and shutdown use this). */
  settled(taskId: string): Promise<void> {
    return this.done.get(taskId) ?? Promise.resolve()
  }

  start(taskId: string, step: Step): void {
    if (this.running.has(taskId)) throw conflict('Task is already running')
    const controller = new AbortController()
    this.running.set(taskId, controller)
    const loop = this.drive(taskId, step, controller.signal)
      .catch((error: unknown) => {
        updateTask(this.ctx, taskId, (t) => { t.status = 'failed'; t.error = `Internal error: ${errorMessage(error)}` })
      })
      .finally(() => { this.running.delete(taskId) })
    this.done.set(taskId, loop)
  }

  // ── commands ───────────────────────────────────────────────
  cancel(taskId: string): Task {
    const controller = this.running.get(taskId)
    if (controller) {
      controller.abort()
      return this.ctx.store.getTask(taskId)!
    }
    const task = this.ctx.store.getTask(taskId)!
    if (task.status === 'completed' || task.status === 'canceled') throw conflict(`Task is already ${task.status}`)
    return updateTask(this.ctx, taskId, (t) => { t.status = 'canceled'; t.waitReason = null })
  }

  resume(taskId: string): void {
    const task = this.ctx.store.getTask(taskId)!
    if (task.status !== 'paused' && task.status !== 'failed') throw conflict(`Only paused or failed tasks can be resumed (task is ${task.status})`)
    if (task.workspace?.removed) throw conflict('The task workspace was removed; start a new task')
    updateTask(this.ctx, taskId, (t) => { t.status = 'queued'; t.error = null })
    this.start(taskId, { kind: 'run', stage: task.stage })
  }

  approvePlan(taskId: string, approve: boolean, note: string | undefined, source: 'desktop' | 'remote'): void {
    const task = this.ctx.store.getTask(taskId)!
    if (task.status !== 'waiting_input' || task.waitReason !== 'plan_approval') throw conflict('This task is not waiting for plan approval')
    updateTask(this.ctx, taskId, (t) => {
      t.checksApproved = approve
      if (note) t.feedback.push({ at: isoNow(), text: note, source })
    })
    this.ctx.store.audit(source, approve ? 'plan.approved' : 'plan.rejected', { taskId })
    this.continueWith(taskId, afterPlanDecision(approve))
  }

  decide(taskId: string, decision: FinalDecision, feedback: string | undefined, source: 'desktop' | 'remote'): void {
    const task = this.ctx.store.getTask(taskId)!
    if (task.status !== 'waiting_input' || task.waitReason !== 'final_approval') throw conflict('This task is not waiting for a final decision')
    if (decision === 'request_changes' && !feedback) throw invalid('Describe the changes you want')
    if (feedback) updateTask(this.ctx, taskId, (t) => { t.feedback.push({ at: isoNow(), text: feedback, source }); t.error = null })
    this.ctx.store.audit(source, `task.${decision}`, { taskId, headSha: task.workspace?.headSha ?? null })
    this.continueWith(taskId, afterFinalDecision(decision))
  }

  async rollback(taskId: string, source: 'desktop' | 'remote'): Promise<Task> {
    const task = this.ctx.store.getTask(taskId)!
    if (task.outcome !== 'applied' || !task.applied) throw conflict('Only applied tasks can be rolled back')
    const root = this.ctx.store.getProject(task.projectId)!.root
    const sha = await this.ctx.workspaces.rollback(root, task.applied, `${task.title} (${task.id.slice(-8)})`)
    this.ctx.store.audit(source, 'task.rollback', { taskId, revertSha: sha })
    logTask(this.ctx, taskId, 'info', `Rolled back with revert commit ${sha.slice(0, 10)}`)
    return updateTask(this.ctx, taskId, (t) => { t.applied = { ...t.applied!, rolledBackSha: sha }; t.outcome = 'rolled_back' })
  }

  /** Marks work interrupted by a previous crash. Nothing is re-run automatically. */
  recover(): number {
    let count = 0
    for (const run of this.ctx.store.runsWithStatus('running')) {
      this.ctx.store.putRun({ ...run, status: 'interrupted', endedAt: isoNow(), error: 'Hydra stopped while this run was active' })
    }
    for (const task of this.ctx.store.tasksWithStatus([...ACTIVE])) {
      count++
      updateTask(this.ctx, task.id, (t) => {
        t.status = 'paused'
        t.error = 'Hydra stopped while this task was running. Completed stages are kept; resume to re-run the interrupted stage.'
        for (const record of t.stages) if (record.status === 'running') { record.status = 'interrupted'; record.endedAt = isoNow() }
      })
    }
    return count
  }

  async shutdown(): Promise<void> {
    for (const controller of this.running.values()) controller.abort()
    await Promise.allSettled([...this.done.values()])
  }

  // ── internals ──────────────────────────────────────────────
  private continueWith(taskId: string, step: Step): void {
    if (step.kind === 'run') {
      updateTask(this.ctx, taskId, (t) => { t.status = 'queued'; t.waitReason = null })
      this.start(taskId, step)
    } else {
      void this.settle(taskId, step)
    }
  }

  private async drive(taskId: string, initial: Step, signal: AbortSignal): Promise<void> {
    let step = initial
    while (step.kind === 'run') {
      if (signal.aborted) return this.markCanceled(taskId, step.stage)
      const stage = step.stage
      const attempt = this.beginStage(taskId, stage)
      const runner = STAGE_RUNNERS[stage]
      let result: StageResult
      try {
        if (!runner) throw new Error(`No runner for stage ${stage}`)
        result = await runner({ ctx: this.ctx, taskId, signal })
      } catch (error) {
        if (error instanceof CanceledError || signal.aborted) return this.markCanceled(taskId, stage, attempt)
        if (stage === 'apply' && error instanceof HydraError && error.code === 'conflict') {
          this.endStage(taskId, stage, attempt, 'failed', error.message)
          updateTask(this.ctx, taskId, (t) => { t.status = 'waiting_input'; t.waitReason = 'final_approval'; t.stage = 'approval'; t.error = error.message })
          return
        }
        const prefix = error instanceof BudgetExceededError ? 'Budget limit reached' : `${stage} failed`
        result = { stage, ok: false, error: error instanceof BudgetExceededError ? `${prefix}: ${error.message}` : errorMessage(error) }
        if (error instanceof BudgetExceededError) logTask(this.ctx, taskId, 'error', `${prefix}: ${error.message}`)
      }
      if (signal.aborted) return this.markCanceled(taskId, stage, attempt)
      this.endStage(taskId, stage, attempt, result.ok ? 'succeeded' : 'failed', result.ok ? null : result.error)
      const fresh = this.ctx.store.getTask(taskId)!
      step = nextStep(fresh, result, policyFor(fresh.mode))
    }
    await this.settle(taskId, step)
  }

  private async settle(taskId: string, step: Exclude<Step, { kind: 'run' }>): Promise<void> {
    if (step.kind === 'wait') {
      updateTask(this.ctx, taskId, (t) => {
        t.status = 'waiting_input'
        t.waitReason = step.reason
        t.stage = step.reason === 'final_approval' ? 'approval' : t.stage
      })
      logTask(this.ctx, taskId, 'info', step.reason === 'plan_approval' ? 'Waiting for you to approve the plan and checks' : 'Ready for your review: accept, request changes, or reject')
      return
    }
    if (step.kind === 'fail') {
      updateTask(this.ctx, taskId, (t) => { t.status = 'failed'; t.error = step.error })
      return
    }
    const task = this.ctx.store.getTask(taskId)!
    const root = this.ctx.store.getProject(task.projectId)?.root
    let workspace = task.workspace
    try {
      if (root && workspace && !workspace.removed) {
        if (step.outcome === 'discarded') workspace = await this.ctx.workspaces.discard(root, workspace)
        if (step.outcome === 'kept_branch') workspace = await this.ctx.workspaces.release(root, workspace)
      }
    } catch (error) {
      logTask(this.ctx, taskId, 'warn', `Workspace cleanup incomplete: ${errorMessage(error)}`)
    }
    updateTask(this.ctx, taskId, (t) => { t.status = 'completed'; t.outcome = step.outcome; t.waitReason = null; t.workspace = workspace })
  }

  private beginStage(taskId: string, stage: TaskStage): number {
    let attempt = 1
    updateTask(this.ctx, taskId, (t) => {
      attempt = t.stages.filter((s) => s.stage === stage).length + 1
      t.status = 'running'
      t.stage = stage
      t.waitReason = null
      t.stages.push({ stage, attempt, status: 'running', startedAt: isoNow(), endedAt: null, note: null })
    })
    return attempt
  }

  private endStage(taskId: string, stage: TaskStage, attempt: number, status: 'succeeded' | 'failed' | 'canceled', note: string | null): void {
    updateTask(this.ctx, taskId, (t) => {
      const record = t.stages.find((s) => s.stage === stage && s.attempt === attempt)
      if (record) { record.status = status; record.endedAt = isoNow(); record.note = note?.slice(0, 4000) ?? null }
    })
  }

  private markCanceled(taskId: string, stage: TaskStage, attempt?: number): void {
    if (attempt) this.endStage(taskId, stage, attempt, 'canceled', 'Canceled by user')
    updateTask(this.ctx, taskId, (t) => { t.status = 'canceled'; t.waitReason = null })
    logTask(this.ctx, taskId, 'info', 'Canceled. The isolated workspace is kept until you delete the task.')
  }
}
