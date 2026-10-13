import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { join } from 'path'
import type { CreateTaskPayload, HydraTask, TaskCommand, TaskRole, TaskAttempt, TaskPhase } from '@shared/tasks'
import { TASK_ACTIVE_PHASES } from '@shared/tasks'
import { canonicalProjectRoot } from '../security/pathPolicy'
import { atomicWriteJson } from './atomicStore'
import { collectProjectContext } from './projectContext'
import type { TaskProviderAdapter } from './providerAdapters'
import { createTaskSchema, taskCommandSchema } from './taskSchemas'
import { persistedTaskStoreSchema } from './persistedTaskSchema'
import { projectVerificationPlan, validateVerification } from './verification'

const now = () => new Date().toISOString()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const MAX_REPAIRS = 1
const MAX_ATTEMPTS = 12

function structured(text: string): any {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(raw) } catch { return null }
}

/** Project leases span write → review → fix → verification, not individual CLI invocations. */
export class ProjectWriterLeases {
  private owners = new Map<string, string>()
  private waiters = new Map<string, Set<() => void>>()
  private key(root: string) { return process.platform === 'win32' ? root.toLowerCase() : root }
  held(root: string): boolean { return this.owners.has(this.key(root)) }
  async acquire(root: string, owner: string, signal: AbortSignal): Promise<() => void> {
    const key = this.key(root)
    while (this.owners.has(key)) {
      if (signal.aborted) throw new Error('Task canceled')
      await new Promise<void>((resolve, reject) => {
        const wake = () => { cleanup(); resolve() }
        const abort = () => { cleanup(); reject(new Error('Task canceled')) }
        const cleanup = () => { this.waiters.get(key)?.delete(wake); signal.removeEventListener('abort', abort) }
        const waiters = this.waiters.get(key) ?? new Set<() => void>()
        waiters.add(wake); this.waiters.set(key, waiters)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    if (signal.aborted) throw new Error('Task canceled')
    this.owners.set(key, owner)
    return () => {
      if (this.owners.get(key) !== owner) return
      this.owners.delete(key)
      for (const wake of [...(this.waiters.get(key) ?? [])]) wake()
    }
  }
}

interface PersistedTasks { schemaVersion: 1; tasks: HydraTask[]; projectDecisions: Record<string, string[]> }

export class TaskCoordinator extends EventEmitter {
  private tasks = new Map<string, HydraTask>()
  private executions = new Map<string, AbortController>()
  private leases = new ProjectWriterLeases()
  private projectDecisions: Record<string, string[]> = {}
  private readonly storePath: string
  private persistenceError: string | null = null

  constructor(baseDir: string, private adapters: TaskProviderAdapter[], private context = collectProjectContext) {
    super()
    this.storePath = join(baseDir, 'tasks.json')
    if (existsSync(this.storePath)) { try {
      const saved = persistedTaskStoreSchema.parse(JSON.parse(readFileSync(this.storePath, 'utf8'))) as PersistedTasks
      if (saved.schemaVersion !== 1 || !Array.isArray(saved.tasks)) throw new Error('Unsupported task store; refusing to overwrite task history')
      this.projectDecisions = saved.projectDecisions ?? {}
      for (const task of saved.tasks) {
        if (!task.id || !Array.isArray(task.messages) || !Array.isArray(task.attempts)) throw new Error('Invalid persisted task history')
        if (TASK_ACTIVE_PHASES.includes(task.phase)) {
          task.phase = 'interrupted'; task.error = 'Daemon restarted during execution. Retry explicitly after inspecting project changes.'
          for (const attempt of task.attempts) if (attempt.status === 'running') { attempt.status = 'failed'; attempt.error = task.error; attempt.endedAt = now() }
          task.events.push({ sequence: task.events.length + 1, at: now(), phase: 'interrupted', text: task.error })
        }
        this.tasks.set(task.id, task)
      }
      this.persist()
    } catch { this.persistenceError = 'Task history is unreadable or invalid. The original tasks.json was preserved; restore a valid backup before using task chat. Legacy Agents remain available.' } }
  }

  list(): HydraTask[] { if (this.persistenceError) throw new Error(this.persistenceError); return clone([...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) }
  get(id: string): HydraTask { const task = this.tasks.get(id); if (!task) throw new Error('Task not found'); return clone(task) }

  async create(input: CreateTaskPayload): Promise<HydraTask> {
    const payload = createTaskSchema.parse(input)
    if (this.persistenceError) throw new Error(this.persistenceError)
    if (this.tasks.size >= 1000) throw new Error('Conversation limit reached (1000); archive task history before creating more')
    const root = await canonicalProjectRoot(payload.projectDir)
    const task: HydraTask = { id: randomUUID(), title: payload.prompt.slice(0, 70), projectDir: root,
      providers: payload.providers, permissionMode: payload.permissionMode, intent: payload.intent === 'implement' ? 'implement' : 'analyze', intentOverride: payload.intent,
      phase: 'planning', createdAt: now(), updatedAt: now(), messages: [{ id: randomUUID(), role: 'user', content: payload.prompt, attachments: payload.attachments, createdAt: now() }],
      attempts: [], findings: [], decisions: [...(this.projectDecisions[this.rootKey(root)] ?? [])], events: [], approval: null,
      writer: null, repairRounds: 0, error: null, repository: '', relevantFiles: [] }
    this.tasks.set(task.id, task)
    this.transition(task, 'planning', 'Inspecting project and independently analyzing the request')
    this.launch(task)
    return this.get(task.id)
  }

  async command(id: string, input: TaskCommand): Promise<HydraTask> {
    if (this.persistenceError) throw new Error(this.persistenceError)
    const command = taskCommandSchema.parse(input)
    const task = this.tasks.get(id)
    if (!task) throw new Error('Task not found')
    if (command.action === 'rename') { task.title = command.title; this.save(task); return this.get(id) }
    if (command.action === 'cancel') {
      const execution = this.executions.get(id)
      if (execution) { execution.abort(); this.saveEvent(task, 'Cancellation requested; waiting for provider processes to close') }
      else if (task.phase === 'awaiting_approval') this.transition(task, 'canceled', 'Task canceled')
      return this.get(id)
    }
    if (this.executions.has(id)) throw new Error('Task is running. Stop it before editing or submitting a follow-up.')
    if (command.action === 'approve') {
      if (task.phase !== 'awaiting_approval' || task.approval?.status !== 'pending' || task.approval.id !== command.approvalId) throw new Error('Approval is stale or not pending')
      task.approval.status = command.approved ? 'approved' : 'denied'
      if (!command.approved) this.transition(task, 'blocked', 'Project write approval denied')
      else { this.transition(task, 'queued', 'Approved bounded project writes for this task only'); this.launch(task, true) }
      return this.get(id)
    }
    if (task.phase === 'awaiting_approval') throw new Error('Resolve the pending approval or stop this task first')
    if (task.messages.length >= 200) throw new Error('Conversation turn limit reached; start a new task in this project')
    if (command.action === 'message') task.messages.push({ id: randomUUID(), role: 'user', content: command.prompt, attachments: command.attachments, createdAt: now() })
    else if (command.action === 'continue') task.messages.push({ id: randomUUID(), role: 'user', content: 'Continue from the previous findings. Resolve remaining issues and verify; preserve the original objective.', createdAt: now() })
    // Approval never carries over to new turns, retries, or changed requests.
    task.approval = null; task.findings = []; task.repairRounds = 0; task.error = null
    this.transition(task, 'planning', command.action === 'retry' ? 'Retrying with current project state' : 'Continuing with durable shared context')
    this.launch(task)
    return this.get(id)
  }

  shutdown(): void { for (const controller of this.executions.values()) controller.abort() }
  private externalWriter: (root: string) => boolean = () => false
  setExternalWriterCheck(check: (root: string) => boolean): void { this.externalWriter = check }
  ownsProject(root: string): boolean {
    try { return this.leases.held(realpathSync(root)) } catch { return false }
  }
  private rootKey(root: string) { return process.platform === 'win32' ? root.toLowerCase() : root }
  private launch(task: HydraTask, approved = false): void {
    if (this.executions.size >= 4) { this.transition(task, 'blocked', 'Four tasks are already active. Retry when a task finishes.'); return }
    const controller = new AbortController()
    this.executions.set(task.id, controller)
    const totalBudget = setTimeout(() => controller.abort(), task.permissionMode === 'autonomous' ? 60 * 60_000 : 40 * 60_000)
    totalBudget.unref()
    void this.execute(task, controller.signal, approved).catch(error => {
      task.error = (error as Error).message
      const canceled = controller.signal.aborted && !task.error.startsWith('Cancellation failed:')
      this.transition(task, canceled ? 'canceled' : 'failed', task.error)
      task.messages.push({ id: randomUUID(), role: 'hydra', content: `${canceled ? 'Stopped' : 'Task failed'}. ${task.error}\n\nInspect agent activity and project changes before retrying.`, createdAt: now() })
      this.save(task)
    }).finally(() => { clearTimeout(totalBudget); this.executions.delete(task.id) })
  }

  private async execute(task: HydraTask, signal: AbortSignal, approved: boolean): Promise<void> {
    const start = task.attempts.length
    const available: TaskProviderAdapter[] = []
    for (const id of task.providers) {
      const adapter = this.adapters.find(v => v.id === id)
      try { if (adapter && await adapter.available()) { available.push(adapter); continue } } catch { /* unavailable capability */ }
      this.saveEvent(task, `${id} CLI unavailable or required safe capabilities unsupported`)
    }
    if (!available.length) throw new Error('No selected CLI is available with supported permissions')
    if (signal.aborted) throw new Error('Task canceled')
    const canonical = await canonicalProjectRoot(task.projectDir)
    if (this.rootKey(canonical) !== this.rootKey(task.projectDir)) throw new Error('Project root changed; start a new conversation')
    let snapshot = await this.context(canonical)
    task.repository = snapshot.repository; task.relevantFiles = snapshot.files
    const base = this.taskContext(task)
    if (!approved) {
      // Each analyst receives the same input, without the other analyst's new answer.
      const analyses = await Promise.allSettled(available.map(adapter => this.run(task, adapter, 'analysis', `${base}\nProject snapshot:\n${snapshot.snapshot}\nIndependently inspect the latest user request. Return JSON {"intent":"analyze"|"implement", "summary":"...", "plan":["..."], "writerConfidence":0.0, "decisions":["..."]}. Questions/explanations/reviews require analyze; explicit build/fix/change requests require implement. Do not change files.`, signal, start)))
      if (analyses.every(v => v.status === 'rejected')) throw new Error('All independent analyses failed; inspect activity for diagnostics')
      const successful = analyses.flatMap((v, i) => v.status === 'fulfilled' ? [{ adapter: available[i], result: v.value }] : [])
      for (const analysis of successful) {
        const parsed = structured(analysis.result.summary)
        if (Array.isArray(parsed?.plan)) this.saveEvent(task, `${analysis.adapter.label} plan: ${parsed.plan.filter((v: unknown) => typeof v === 'string').slice(0, 8).join(' → ')}`)
      }
      if (task.intentOverride && task.intentOverride !== 'auto') task.intent = task.intentOverride
      else {
        const latest = [...task.messages].reverse().find(v => v.role === 'user')?.content ?? ''
        const explicitWrite = /\b(?:implement|build|fix|improve|create|add|change|refactor|repair|update|write)\b/i.test(latest)
        const explicitRead = /\b(?:explain|inspect|analy[sz]e|review|architecture|describe|compare|summari[sz]e|what|why|how)\b/i.test(latest)
        const question = /^\s*(?:explain|describe|tell me|how\b|why\b|what\b|(?:can|could|would) you explain)/i.test(latest) && !/\bthen\s+(?:implement|build|fix|change|add|write)\b/i.test(latest)
        const votes = successful.map(v => structured(v.result.summary)?.intent).filter(v => v === 'analyze' || v === 'implement')
        task.intent = question ? 'analyze' : votes.length ? votes.every(v => v === 'implement') ? 'implement' : 'analyze' : explicitWrite && !explicitRead ? 'implement' : 'analyze'
      }
      this.saveEvent(task, `Latest turn routed to ${task.intent}${task.intentOverride && task.intentOverride !== 'auto' ? ' (explicit override)' : ' automatically'}`)
      const writers = successful.filter(v => v.adapter.canWrite && (v.adapter.supportsSandbox || (task.permissionMode !== 'autonomous' && v.adapter.confinedFileWrites)))
        .sort((a, b) => Number(structured(b.result.summary)?.writerConfidence ?? 0) - Number(structured(a.result.summary)?.writerConfidence ?? 0))
      task.writer = writers[0]?.adapter.id ?? null
    }
    if (task.intent === 'analyze') {
      this.transition(task, 'synthesis', 'Comparing independent findings')
      const summary = await this.run(task, available[0], 'synthesis', `${this.taskContext(task)}\nSynthesize the findings into one concise answer. Explain disagreements, limitations, and actionable next steps. Do not claim implementation or verification occurred.`, signal, start)
      task.messages.push({ id: randomUUID(), role: 'hydra', content: `${summary.summary}\n\nAnalysis only; no implementation or test verification was performed.`, createdAt: now() })
      this.rememberDecisions(task, start)
      this.transition(task, 'completed', 'Analysis complete')
      return
    }
    const writer = available.find(v => v.id === task.writer && v.canWrite && (v.supportsSandbox || (task.permissionMode !== 'autonomous' && v.confinedFileWrites)))
    if (!writer) {
      task.error = 'No selected writer supports these permissions. Autonomous requires an OS-sandboxed provider. Claude supports confined file writes in Safe/Developer, without shell execution.'
      this.transition(task, 'blocked', task.error); return
    }
    if (task.permissionMode === 'safe' && task.approval?.status !== 'approved') {
      task.approval = { id: randomUUID(), reason: `${writer.label} needs permission for project edits and verification. ${writer.supportsSandbox ? 'Codex uses its project sandbox with network access disabled.' : 'Claude uses restricted file tools confined to this root, without shell tools; this is not an OS sandbox.'} No sandbox escalation, pushes or deployment.`, scope: canonical, status: 'pending', createdAt: now() }
      this.transition(task, 'awaiting_approval', 'Approval required before meaningful project actions'); return
    }
    this.transition(task, 'queued', 'Waiting for exclusive writer ownership of this canonical project')
    const release = await this.leases.acquire(canonical, task.id, signal)
    try {
      const currentRoot = await canonicalProjectRoot(task.projectDir)
      if (this.rootKey(currentRoot) !== this.rootKey(canonical)) throw new Error('Canonical project root changed while queued; refusing writer execution')
      if (this.externalWriter(canonical)) throw new Error('An interactive agent is already running in this project. Stop it before starting coordinated writes.')
      snapshot = await this.context(canonical)
      task.verificationPlan = await projectVerificationPlan(canonical)
      this.transition(task, 'implementation', `${writer.label} owns project implementation`)
      await this.run(task, writer, 'implementation', `${this.taskContext(task)}\nCurrent project snapshot:\n${snapshot.snapshot}\nImplement the request. Make a lightweight plan and execute it. Do not deploy, push, read credentials, make destructive changes, or access another project. Stay within the configured sandbox. Run appropriate local checks. Report actual changes, decisions and unresolved issues.`, signal, start)
      const reviewers = available.filter(v => v.id !== writer.id)
      const reviewer = reviewers[0] ?? writer
      let reviewPassed = false
      let reviewedFingerprint = ''
      for (let round = 0; round <= MAX_REPAIRS; round++) {
        const current = await this.context(canonical)
        task.contextFingerprint = current.fingerprint; task.contextOmissions = current.omissions
        this.transition(task, 'review', `${reviewer.label} reviews current implementation${reviewer.id === writer.id ? ' (same-provider review; independent provider unavailable)' : ''}`)
        const review = await this.run(task, reviewer, 'review', `${this.taskContext(task)}\nCurrent project files:\n${current.snapshot}\nReview implementation critically against the original request. Challenge prior findings. Return ONLY JSON {"verdict":"pass"|"changes_required", "findings":["specific actionable issue"], "summary":"..."}. Use changes_required if context is insufficient. No writes or test execution.`, signal, start)
        const verdict = structured(review.summary)
        if (!verdict || !['pass', 'changes_required'].includes(verdict.verdict) || !Array.isArray(verdict.findings) || verdict.findings.some((v: unknown) => typeof v !== 'string')) {
          task.error = 'Reviewer did not return a valid structured verdict; completion cannot be certified'
          this.transition(task, 'blocked', task.error); return
        }
        const findings = verdict.findings.slice(0, 20) as string[]
        if (verdict.verdict === 'pass' && !findings.length) {
          reviewPassed = true
          reviewedFingerprint = current.fingerprint
          for (const finding of task.findings) if (finding.disposition === 'open') finding.disposition = 'addressed'
          break
        }
        task.findings.push(...findings.map(text => ({ id: randomUUID(), provider: reviewer.id, text: text.slice(0, 3000), disposition: 'open' as const })))
        if (round === MAX_REPAIRS || !findings.length) break
        task.repairRounds++
        this.transition(task, 'repair', `${writer.label} addresses review findings (bounded repair ${task.repairRounds}/${MAX_REPAIRS})`)
        await this.run(task, writer, 'repair', `${this.taskContext(task)}\nAddress valid reviewer findings. Explain accepted and rejected findings with reasons. Do not deploy, push, access credentials or another project. Report repairs and checks.`, signal, start)
      }
      if (!reviewPassed) {
        for (const finding of task.findings) if (finding.disposition === 'open') finding.disposition = 'unresolved'
        task.error = 'Review remains unresolved after the repair budget. Inspect findings and continue explicitly.'
        this.transition(task, 'blocked', task.error); return
      }
      this.transition(task, 'verification', `${writer.label} verifies with project checks`)
      const verifier = available.find(v => v.supportsSandbox) ?? writer
      const fileOnly = !verifier.supportsSandbox
      const verification = await this.run(task, verifier, 'verification', `${this.taskContext(task)}\n${fileOnly ? 'Restricted-file verification only: use Read to inspect the changed files and verify the request against actual contents. You have no shell tools. Do not claim tests/build passed.' : `Execute EVERY planned command exactly, as a separate command in the project root: ${JSON.stringify(task.verificationPlan)}. Do not substitute echo, file reading or a different command. If no plan exists report that limitation.`}\nDo not modify implementation now; if verification fails report it. No deployments, pushes, destructive operations or escalation. Explain actual checks and limitations.`, signal, start)
      const validation = validateVerification(task.verificationPlan, verification.evidence)
      const checks = fileOnly ? verification.evidence.filter(v => v.kind === 'file' && v.tool === 'Read') : validation.checks
      if ((!fileOnly && !validation.ok) || (fileOnly && !checks.length)) {
        task.error = fileOnly ? 'No restricted Read verification was observed; tests/build cannot be verified without a shell-capable provider.' : validation.reason
        this.transition(task, 'blocked', task.error); return
      }
      const afterVerification = await this.context(canonical)
      if (afterVerification.fingerprint !== reviewedFingerprint) { task.error = 'Project contents changed after review; verification cannot certify the reviewed revision.'; this.transition(task, 'blocked', task.error); return }
      this.transition(task, 'synthesis', 'Preparing one result with observed verification evidence')
      const passedReview = task.attempts.slice(start).findLast(attempt => attempt.role === 'review' && attempt.status === 'completed')!
      const synthesisContext = JSON.stringify({ objective: task.messages.find(message => message.role === 'user')?.content,
        latestRequest: [...task.messages].reverse().find(message => message.role === 'user')?.content,
        authoritativeReview: { writer: writer.label, reviewer: reviewer.label, independentProvider: reviewer.id !== writer.id, verdict: 'pass', result: structured(passedReview.summary) },
        authoritativeVerification: { scope: fileOnly ? 'restricted file reads only; tests/build unverified' : 'every planned project check passed', checks },
        currentReviewedFiles: afterVerification.snapshot, omissions: afterVerification.omissions, remainingFindings: task.findings.filter(finding => finding.disposition === 'unresolved') })
      const synthesis = await this.run(task, available.find(v => v.id !== writer.id) ?? writer, 'synthesis', `${synthesisContext}\nSynthesize one concise result from these authoritative records and current reviewed files. An independent review means a different provider from the WRITER, regardless of who did analysis. The canonical review already passed. Earlier incidental provider attempts are not outstanding review requirements. Do not invent authentication failures, test counts or UI verification. Explain changes and actual limitations.`, signal, start)
      const evidence = checks.map(v => `- ${fileOnly ? 'Read observed' : `Exit ${v.exitCode}`}: \`${v.command.replace(/`/g, '')}\``).join('\n')
      task.messages.push({ id: randomUUID(), role: 'hydra', content: `**${fileOnly ? 'Completed with limited file verification' : 'Completed'}** · ${reviewer.id !== writer.id ? 'Independent provider review passed' : 'Same-provider review passed'}\n\n${synthesis.summary}\n\n**Observed ${fileOnly ? 'restricted file inspection' : 'verification commands'}**\n${evidence}\n${fileOnly ? '\nLimited verification: file contents were inspected; automated tests, typechecks, builds and runtime/UI behavior were NOT verified. Include Codex for shell checks.\n' : ''}\nWriter: ${writer.label}. Reviewer: ${reviewer.label}${reviewer.id === writer.id ? ' (same provider)' : ''}. UI verification requires explicit recorded evidence.`, createdAt: now() })
      this.rememberDecisions(task, start)
      this.transition(task, 'completed', fileOnly ? 'Implementation reviewed; restricted file inspection only (tests/build unverified)' : 'Implementation reviewed and every planned project check succeeded')
    } finally { release() }
  }

  private taskContext(task: HydraTask): string {
    return JSON.stringify({ objective: task.messages.find(v => v.role === 'user')?.content,
      recentTurns: task.messages.slice(-6).map(v => ({ role: v.role, content: v.content.slice(0, 8000), attachments: v.attachments })),
      project: task.projectDir, repository: task.repository, relevantFiles: task.relevantFiles,
      decisions: task.decisions.slice(-20), findings: task.findings,
      latestRequest: [...task.messages].reverse().find(v => v.role === 'user')?.content, intent: task.intent,
      verificationPlan: task.verificationPlan, contextFingerprint: task.contextFingerprint, contextOmissions: task.contextOmissions,
      attempts: task.attempts.slice(-10).map(v => ({ provider: v.provider, role: v.role, status: v.status, summary: v.summary.slice(0, 7000), evidence: v.evidence, error: v.error })),
      permissions: { mode: task.permissionMode, root: task.projectDir, forbidden: ['deploy', 'push', 'credential access', 'destructive operations', 'sandbox escalation'] } })
  }

  private async run(task: HydraTask, adapter: TaskProviderAdapter, role: TaskRole, prompt: string, signal: AbortSignal, start: number): Promise<TaskAttempt> {
    if (signal.aborted) throw new Error('Task canceled')
    const currentRoot = await canonicalProjectRoot(task.projectDir)
    if (this.rootKey(currentRoot) !== this.rootKey(task.projectDir)) throw new Error('Canonical project root changed before execution')
    if (task.attempts.length - start >= MAX_ATTEMPTS) throw new Error('Task execution attempt budget exhausted')
    const attempt: TaskAttempt = { id: randomUUID(), provider: adapter.id, role, status: 'running', runId: null, sessionId: null, startedAt: now(), endedAt: null, summary: '', logs: '', evidence: [], error: null }
    task.attempts.push(attempt); this.save(task)
    let textFlush: ReturnType<typeof setTimeout> | null = null
    try {
      if (signal.aborted) throw new Error('Task canceled before provider execution')
      const result = await adapter.execute({ root: task.projectDir, prompt: prompt.slice(0, 160000), role, mode: task.permissionMode, signal,
        onRun: id => { attempt.runId = id; this.save(task) },
        onText: text => {
          attempt.summary = text.slice(-100000)
          this.emit('text', { taskId: task.id, attemptId: attempt.id, role, provider: adapter.id, text: attempt.summary })
          if (!textFlush) textFlush = setTimeout(() => { textFlush = null; try { this.save(task) } catch { signal.aborted || this.executions.get(task.id)?.abort() } }, 1000)
        },
        onLog: line => { attempt.logs = (attempt.logs + line + '\n').slice(-32000); this.emit('activity', { taskId: task.id, attemptId: attempt.id, line: line.slice(-12000) }) } })
      if (signal.aborted) throw new Error('Task canceled')
      attempt.runId = result.runId; attempt.sessionId = result.result.sessionId
      attempt.summary = result.result.text; attempt.evidence = result.result.evidence
      if (result.result.failed || !result.result.terminal) throw new Error(result.result.error || 'Missing provider semantic completion')
      attempt.status = 'completed'
      return attempt
    } catch (error) {
      attempt.status = signal.aborted && !(error as Error).message.startsWith('Cancellation failed:') ? 'canceled' : 'failed'; attempt.error = (error as Error).message
      throw error
    } finally { if (textFlush) clearTimeout(textFlush); attempt.endedAt = now(); this.save(task) }
  }

  private rememberDecisions(task: HydraTask, start: number): void {
    for (const attempt of task.attempts.slice(start).filter(v => v.role === 'analysis' && v.status === 'completed')) {
      const decisions = structured(attempt.summary)?.decisions
      if (Array.isArray(decisions)) for (const value of decisions) if (typeof value === 'string' && value.length <= 1000 && !task.decisions.includes(value)) task.decisions.push(value)
    }
    task.decisions = task.decisions.slice(-30)
    this.projectDecisions[this.rootKey(task.projectDir)] = task.decisions
  }
  private transition(task: HydraTask, phase: TaskPhase, text: string): void { task.phase = phase; this.saveEvent(task, text) }
  private saveEvent(task: HydraTask, text: string): void {
    task.events.push({ sequence: (task.events.at(-1)?.sequence ?? 0) + 1, at: now(), phase: task.phase, text })
    task.events = task.events.slice(-500); this.save(task)
  }
  private save(task: HydraTask): void { task.updatedAt = now(); this.persist(); this.emit('changed', clone(task)) }
  private persist(): void {
    try { atomicWriteJson(this.storePath, { schemaVersion: 1, tasks: [...this.tasks.values()], projectDecisions: this.projectDecisions }) }
    catch (error) { this.persistenceError = `Task persistence failed: ${(error as Error).message}`; throw new Error(this.persistenceError) }
  }
}
