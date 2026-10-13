import type { Task, TaskStage } from '@hydra/protocol'
import { currentBranch, headSha, isAncestor } from '../isolation/git.js'
import { killOrphanAgent } from '../process/instance.js'
import { afterFinalDecision, afterPlanDecision, nextStep, type FinalDecision, type StageResult, type Step } from '../workflow/machine.js'
import { policyFor } from '../workflow/policy.js'
import { BudgetExceededError, CanceledError, conflict, errorMessage, HydraError, invalid, ProviderUnavailableError } from '../util/errors.js'
import { isoNow } from '../util/ids.js'
import { type EngineContext, logTask, updateTask } from './context.js'
import { ReapprovalNeeded, STAGE_RUNNERS } from './stages.js'

/** Serializes operations that mutate a user's repository (apply, rollback) per project. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>()
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const normalized = process.platform === 'win32' ? key.toLowerCase() : key
    const previous = this.tails.get(normalized) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(normalized, tail)
    await previous
    try { return await fn() } finally {
      release()
      if (this.tails.get(normalized) === tail) this.tails.delete(normalized)
    }
  }
}

export class Orchestrator {
  private readonly running = new Map<string, AbortController>()
  private readonly done = new Map<string, Promise<void>>()
  private readonly repoLock = new KeyedMutex()

  constructor(private readonly ctx: EngineContext) {}

  isRunning(taskId: string): boolean {
    return this.running.has(taskId)
  }

  settled(taskId: string): Promise<void> {
    return this.done.get(taskId) ?? Promise.resolve()
  }

  /** Every continuation (stage runs and settling/cleanup) is tracked here, so nothing races it. */
  private start(taskId: string, step: Step): void {
    if (this.running.has(taskId)) throw conflict('Task is busy')
    const controller = new AbortController()
    this.running.set(taskId, controller)
    const loop = this.drive(taskId, step, controller.signal)
      .catch((error: unknown) => {
        updateTask(this.ctx, taskId, (t) => { t.status = 'failed'; t.error = `Internal error: ${errorMessage(error)}` })
      })
      .finally(() => { this.running.delete(taskId) })
    this.done.set(taskId, loop)
  }

  begin(taskId: string): void {
    this.start(taskId, { kind: 'run', stage: 'plan' })
  }

  // ── commands ───────────────────────────────────────────────
  cancel(taskId: string): Task {
    const task = this.ctx.store.getTask(taskId)!
    if (task.stage === 'apply' && this.running.has(taskId)) throw conflict('The change is being applied to your branch and cannot be canceled midway.')
    const controller = this.running.get(taskId)
    if (controller) {
      controller.abort()
      return task
    }
    if (task.status === 'completed' || task.status === 'canceled') throw conflict(`Task is already ${task.status}`)
    return updateTask(this.ctx, taskId, (t) => { t.status = 'canceled'; t.waitReason = null })
  }

  resume(taskId: string): void {
    const task = this.ctx.store.getTask(taskId)!
    if (this.running.has(taskId)) throw conflict('Task is busy')
    if (task.status !== 'paused' && task.status !== 'failed') throw conflict(`Only paused or failed tasks can be resumed (task is ${task.status})`)
    if (task.workspace?.removed) throw conflict('The task workspace was removed; start a new task')
    const stage = task.stage === 'apply' ? 'approval' : task.stage
    if (stage === 'approval') {
      updateTask(this.ctx, taskId, (t) => { t.status = 'waiting_input'; t.waitReason = 'final_approval'; t.stage = 'approval'; t.error = null })
      return
    }
    updateTask(this.ctx, taskId, (t) => { t.status = 'queued'; t.error = null })
    this.start(taskId, { kind: 'run', stage })
  }

  approvePlan(taskId: string, approve: boolean, note: string | undefined, source: 'desktop' | 'remote'): void {
    const task = this.ctx.store.getTask(taskId)!
    if (this.running.has(taskId) || task.status !== 'waiting_input' || task.waitReason !== 'plan_approval') throw conflict('This task is not waiting for plan approval')
    updateTask(this.ctx, taskId, (t) => {
      t.checksApproved = approve
      if (note) t.feedback.push({ at: isoNow(), text: note, source })
    })
    this.ctx.store.audit(source, approve ? 'plan.approved' : 'plan.rejected', { taskId, checkDigest: task.checkDigest })
    this.continueWith(taskId, afterPlanDecision(approve))
  }

  decide(taskId: string, decision: FinalDecision, feedback: string | undefined, headShaSeen: string | undefined, source: 'desktop' | 'remote'): void {
    const task = this.ctx.store.getTask(taskId)!
    if (this.running.has(taskId) || task.status !== 'waiting_input' || task.waitReason !== 'final_approval') throw conflict('This task is not waiting for a final decision')
    const current = task.workspace?.headSha ?? null
    if (decision === 'accept') {
      if (!headShaSeen) throw invalid('Accept must name the commit you reviewed (headSha)')
      if (headShaSeen !== current) throw conflict('The result changed since you reviewed it. Review the latest version and accept again.')
    }
    if (decision === 'request_changes' && !feedback) throw invalid('Describe the changes you want')
    if (feedback) updateTask(this.ctx, taskId, (t) => { t.feedback.push({ at: isoNow(), text: feedback, source }); t.error = null })
    this.ctx.store.audit(source, `task.${decision}`, { taskId, headSha: current })
    this.continueWith(taskId, afterFinalDecision(decision))
  }

  async rollback(taskId: string, source: 'desktop' | 'remote'): Promise<Task> {
    const task = this.ctx.store.getTask(taskId)!
    if (task.outcome !== 'applied' || !task.applied) throw conflict('Only applied tasks can be rolled back')
    const root = this.ctx.store.getProject(task.projectId)!.root
    return this.repoLock.run(root, async () => {
      const sha = await this.ctx.workspaces.rollback(root, task.applied!, `${task.title.slice(0, 60)} (${task.id.slice(-8)})`)
      this.ctx.store.audit(source, 'task.rollback', { taskId, revertSha: sha })
      logTask(this.ctx, taskId, 'info', `Rolled back with revert commit ${sha.slice(0, 10)}`)
      return updateTask(this.ctx, taskId, (t) => { t.applied = { ...t.applied!, rolledBackSha: sha }; t.outcome = 'rolled_back' })
    })
  }

  /**
   * Reconciles state left by a crash: kills orphaned agent processes (PID verified
   * to still be a provider CLI), finishes or undoes half-done applies, and pauses
   * interrupted tasks. Nothing is re-run automatically.
   */
  async recover(): Promise<number> {
    let count = 0
    for (const run of this.ctx.store.runsWithStatus('running')) {
      if (run.pid && await killOrphanAgent(run.pid)) logTask(this.ctx, run.taskId, 'warn', `Stopped agent process ${run.pid} left running by a previous session`)
      this.ctx.store.putRun({ ...run, status: 'interrupted', endedAt: isoNow(), error: 'Hydra stopped while this run was active' })
    }
    for (const task of this.ctx.store.tasksWithStatus(['queued', 'running'])) {
      count++
      if (task.applyIntent) {
        await this.reconcileApply(task)
        continue
      }
      updateTask(this.ctx, task.id, (t) => {
        t.status = 'paused'
        t.error = 'Hydra stopped while this task was running. Completed stages are kept; resume to re-run the interrupted stage.'
        for (const record of t.stages) if (record.status === 'running') { record.status = 'interrupted'; record.endedAt = isoNow() }
      })
    }
    return count
  }

  private async reconcileApply(task: Task): Promise<void> {
    const root = this.ctx.store.getProject(task.projectId)?.root
    const intent = task.applyIntent!
    let landed = false
    if (root && await currentBranch(root) === intent.targetBranch) {
      const head = await headSha(root)
      landed = Boolean(head && await isAncestor(root, intent.approvedSha, head))
    }
    updateTask(this.ctx, task.id, (t) => {
      for (const record of t.stages) if (record.status === 'running') { record.status = landed ? 'succeeded' : 'interrupted'; record.endedAt = isoNow() }
      t.applyIntent = null
      if (landed) {
        t.applied = { targetBranch: intent.targetBranch, beforeSha: intent.beforeSha, afterSha: intent.approvedSha, method: 'fast_forward', integratedSha: null, rolledBackSha: null }
        t.status = 'completed'
        t.outcome = 'applied'
        t.error = null
      } else {
        t.status = 'waiting_input'
        t.waitReason = 'final_approval'
        t.stage = 'approval'
        t.error = 'Hydra stopped while applying; your branch was not changed. Accept again to apply.'
      }
    })
  }

  async shutdown(): Promise<void> {
    for (const [taskId, controller] of this.running) {
      if (this.ctx.store.getTask(taskId)?.stage !== 'apply') controller.abort()
    }
    await Promise.allSettled([...this.done.values()])
  }

  // ── internals ──────────────────────────────────────────────
  private continueWith(taskId: string, step: Step): void {
    updateTask(this.ctx, taskId, (t) => { t.status = step.kind === 'run' ? 'queued' : 'running'; t.waitReason = null })
    this.start(taskId, step)
  }

  private async drive(taskId: string, initial: Step, signal: AbortSignal): Promise<void> {
    let step = initial
    while (step.kind === 'run') {
      const stage = step.stage
      if (signal.aborted && stage !== 'apply') return this.markCanceled(taskId, stage)
      const attempt = this.beginStage(taskId, stage)
      const runner = STAGE_RUNNERS[stage]
      let result: StageResult
      try {
        if (!runner) throw new Error(`No runner for stage ${stage}`)
        const root = this.ctx.store.getProject(this.ctx.store.getTask(taskId)!.projectId)!.root
        // Apply runs to completion under the per-repository lock; it ignores cancellation.
        result = stage === 'apply'
          ? await this.repoLock.run(root, () => runner({ ctx: this.ctx, taskId, signal: new AbortController().signal }))
          : await runner({ ctx: this.ctx, taskId, signal })
      } catch (error) {
        if (stage !== 'apply' && (error instanceof CanceledError || signal.aborted)) return this.markCanceled(taskId, stage, attempt)
        if (stage === 'apply' && (error instanceof ReapprovalNeeded || (error instanceof HydraError && error.code === 'conflict'))) {
          this.endStage(taskId, stage, attempt, 'failed', error.message)
          updateTask(this.ctx, taskId, (t) => { t.status = 'waiting_input'; t.waitReason = 'final_approval'; t.stage = 'approval'; t.error = error.message; t.applyIntent = null })
          return
        }
        if (error instanceof ProviderUnavailableError) {
          this.endStage(taskId, stage, attempt, 'failed', error.message)
          updateTask(this.ctx, taskId, (t) => { t.status = 'paused'; t.error = `${error.message} Resume when the provider is available again, or start a new task with a different provider.` })
          logTask(this.ctx, taskId, 'warn', error.message)
          return
        }
        const budget = error instanceof BudgetExceededError
        if (budget) logTask(this.ctx, taskId, 'error', `Budget limit reached: ${error.message}`)
        result = { stage, ok: false, error: budget ? `Budget limit reached: ${error.message}` : errorMessage(error) }
      }
      if (signal.aborted && stage !== 'apply') return this.markCanceled(taskId, stage, attempt)
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
      t.error = null
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
