import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  Budget, Command, emptyUsage, PROTOCOL_VERSION, REMOTE_COMMAND_SCOPE, routeRequest, type Route,
  type CommandAck, type DeviceScope, type EngineSnapshot, type EventEnvelope, type Project, type Task, type TaskDetail, type TaskDiff
} from '@hydra/protocol'
import { AdapterRegistry } from './agents/registry.js'
import { headSha, isRepository } from './isolation/git.js'
import { validateProjectRoot } from './isolation/roots.js'
import { WorkspaceManager } from './isolation/workspace.js'
import { enginePaths, type EngineContext, logTask, Semaphore, updateTask } from './orchestrator/context.js'
import { Orchestrator } from './orchestrator/orchestrator.js'
import { Store } from './store/store.js'
import { InstanceLock } from './process/instance.js'
import { conflict, errorMessage, forbidden, HydraError, invalid, notFound, unavailable } from './util/errors.js'
import { isoNow, newId } from './util/ids.js'
import { ownerOnly } from './util/permissions.js'
import { policyFor } from './workflow/policy.js'
import { categoryOf, outcomeFor, recommend } from './intelligence/outcomes.js'
import { checkForUpdate } from './update/updater.js'
import { checksFor, specsFromDrafts, validateCheck } from './verification/custom.js'
import { detectChecks } from './verification/detect.js'
import { runChecks } from './verification/runner.js'

export type Actor = { kind: 'desktop' } | { kind: 'remote'; deviceId: string; scopes: readonly DeviceScope[] }

/** Hooks implemented by the host (hydrad) for features that live outside the engine. */
export interface HostHooks {
  pairStart?(name: string, scopes: DeviceScope[], host?: string): Promise<unknown>
  revokeDevice?(deviceId: string): Promise<unknown>
  remoteStatus?(): { relayUrl: string | null; connected: boolean; addresses?: Array<{ address: string; label: string }>; enabled?: boolean; until?: string | null; host?: string | null }
  remoteEnable?(minutes: number, host?: string): Promise<void>
  remoteDisable?(): Promise<void>
}

export interface EngineOptions {
  dataDir: string
  registry?: AdapterRegistry
  env?: NodeJS.ProcessEnv
  maxConcurrentAgents?: number
  version?: string
  hooks?: HostHooks
  /** Skip provider probing at startup (tests). */
  skipProbe?: boolean
}

export class Engine {
  readonly store: Store
  readonly orchestrator: Orchestrator
  readonly version: string
  private readonly ctx: EngineContext
  private hooks: HostHooks
  private readonly lock: InstanceLock
  private updatePrepared: string | null = null
  private updateLeaseUntil = 0
  private commandsInFlight = 0

  private constructor(options: EngineOptions) {
    const paths = enginePaths(options.dataDir)
    for (const dir of [paths.dataDir, paths.worktrees, paths.checkouts, paths.logs, paths.scratch, paths.backups]) {
      mkdirSync(dir, { recursive: true })
      ownerOnly(dir, 0o700)
    }
    this.lock = new InstanceLock(paths.dataDir)
    this.lock.acquire()
    this.store = new Store(paths.database)
    for (const file of [paths.database, `${paths.database}-wal`, `${paths.database}-shm`]) ownerOnly(file, 0o600)
    this.version = options.version ?? '2.0.0-alpha.0'
    this.hooks = options.hooks ?? {}
    this.ctx = {
      store: this.store,
      registry: options.registry ?? AdapterRegistry.production(options.env),
      workspaces: new WorkspaceManager(paths.worktrees, paths.checkouts),
      paths,
      runtimeVersion: this.version,
      agentSlots: new Semaphore(options.maxConcurrentAgents ?? 3),
      env: options.env ?? process.env
    }
    this.orchestrator = new Orchestrator(this.ctx)
    // Local outcome history: recorded when a task finishes (and again if it is rolled back).
    this.store.subscribe(({ event }) => {
      if (event.type !== 'task.updated') return
      const outcome = outcomeFor(event.task, this.store.listEvidence(event.task.id))
      if (outcome) this.store.recordOutcome(outcome)
    })
  }

  static async open(options: EngineOptions): Promise<Engine> {
    const engine = new Engine(options)
    const interrupted = await engine.orchestrator.recover()
    const swept = await engine.ctx.workspaces.sweepLeftovers(engine.store.listProjects().map((p) => p.root))
    if (swept) engine.store.audit('engine', 'cleanup', { leftoverCheckouts: swept })
    if (interrupted) engine.store.audit('engine', 'recovery', { interruptedTasks: interrupted })
    if (!options.skipProbe) await engine.refreshProviders()
    else await engine.ctx.registry.refresh()
    return engine
  }

  get paths() { return this.ctx.paths }
  get registry() { return this.ctx.registry }

  setHooks(hooks: HostHooks): void {
    this.hooks = { ...this.hooks, ...hooks }
  }

  subscribe(listener: (envelope: EventEnvelope) => void): () => void {
    return this.store.subscribe(listener)
  }

  async refreshProviders() {
    const providers = await this.ctx.registry.refresh()
    this.store.publish({ type: 'providers.updated', providers })
    return providers
  }

  snapshot(): EngineSnapshot {
    return {
      protocolVersion: PROTOCOL_VERSION,
      engineVersion: this.version,
      lastSeq: this.store.lastSeq,
      projects: this.store.listProjects(),
      tasks: this.store.initialTasks(),
      providers: this.ctx.registry.status(),
      devices: this.store.listDevices(),
      activeRuns: this.store.runsWithStatus('running'),
      agentSlots: this.ctx.agentSlots.limit,
      remote: { addresses: [], enabled: false, until: null, host: null, ...(this.hooks.remoteStatus?.() ?? { relayUrl: null, connected: false }) }
    }
  }

  taskDetail(taskId: string): TaskDetail {
    const task = this.store.getTask(taskId)
    if (!task) throw notFound('Task')
    return { task, runs: this.store.listRuns(taskId), evidence: this.store.listEvidence(taskId) }
  }

  async taskDiff(taskId: string): Promise<TaskDiff> {
    const task = this.store.getTask(taskId)
    if (!task) throw notFound('Task')
    if (!task.workspace) throw conflict('This task has no workspace')
    if (task.workspace.removed) throw conflict('The workspace was removed after the task finished')
    const { files, truncated } = await this.ctx.workspaces.diff(task.workspace)
    return { baseSha: task.workspace.baseSha, headSha: task.workspace.headSha ?? task.workspace.baseSha, files, truncated }
  }

  evidenceLogPath(evidenceId: string): string | null {
    if (!/^[0-9a-z]{26}$/.test(evidenceId)) return null
    for (const taskDir of existsSync(this.ctx.paths.logs) ? readdirSync(this.ctx.paths.logs) : []) {
      const path = join(this.ctx.paths.logs, taskDir, `${evidenceId}.log`)
      if (existsSync(path)) return path
    }
    return null
  }

  /** Validates, authorizes and executes a command. Never throws: failures become acks. */
  async execute(input: unknown, actor: Actor = { kind: 'desktop' }): Promise<CommandAck> {
    const parsed = Command.safeParse(input)
    if (!parsed.success) return { ok: false, error: { code: 'invalid', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } }
    const command = parsed.data
    let counted = false
    try {
      if (actor.kind === 'remote') {
        const required = REMOTE_COMMAND_SCOPE[command.type]
        if (!required) throw forbidden(`${command.type} is only available on the desktop`)
        if (!actor.scopes.includes(required)) throw forbidden(`This device lacks the "${required}" permission`)
      }
      if (Date.now() >= this.updateLeaseUntil) this.updatePrepared = null
      if (this.updatePrepared && command.type !== 'update.release' && command.type !== 'update.confirm') throw conflict('Hydra is preparing an update. New work is temporarily blocked.')
      this.commandsInFlight++
      counted = true
      const result = await this.dispatch(command, actor)
      return { ok: true, result: result ?? null }
    } catch (error) {
      if (error instanceof HydraError) return { ok: false, error: { code: error.code, message: error.message } }
      return { ok: false, error: { code: 'internal', message: errorMessage(error) } }
    } finally { if (counted) this.commandsInFlight-- }
  }

  private async dispatch(command: Command, actor: Actor): Promise<unknown> {
    const source = actor.kind === 'remote' ? 'remote' : 'desktop'
    const actorLabel = actor.kind === 'remote' ? `device:${actor.deviceId}` : 'desktop'
    switch (command.type) {
      case 'update.prepare': {
        if (this.commandsInFlight > 1 || this.store.tasksWithStatus(['running', 'queued']).length) throw conflict('Active tasks or operations must finish before updating.')
        const lease = newId()
        this.updatePrepared = lease
        this.updateLeaseUntil = Date.now() + 30_000
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([this.ctx.registry.dispose(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Idle agent shutdown timed out; update postponed.')), 10_000) })])
          if (this.updatePrepared !== lease || Date.now() >= this.updateLeaseUntil) throw conflict('Update preparation expired; retry when ready.')
          const backup = this.backup()
          this.store.audit(actorLabel, 'update.prepared', { backup })
          return { backup, lease }
        } catch (error) { if (this.updatePrepared === lease) this.updatePrepared = null; throw error }
        finally { if (timer) clearTimeout(timer) }
      }
      case 'update.release':
        if (this.commandsInFlight > 1) throw conflict('Update preparation has not finished yet; its lease expires automatically.')
        if (this.updatePrepared === command.lease) this.updatePrepared = null
        return null
      case 'update.confirm':
        if (this.updatePrepared !== command.lease || Date.now() >= this.updateLeaseUntil) throw conflict('Update lease expired. Installation was refused.')
        this.updateLeaseUntil = Date.now() + 60_000
        return null
      case 'project.add': return this.addProject(command.root, command.name)
      case 'project.remove': {
        if (this.store.listTasks(command.projectId).some((t) => this.orchestrator.isRunning(t.id) || t.status === 'waiting_input')) {
          throw conflict('Finish or cancel this project\'s active tasks first')
        }
        this.store.deleteProject(command.projectId)
        return null
      }
      case 'project.checks.get': {
        const project = this.store.getProject(command.projectId)
        if (!project) throw notFound('Project')
        let detected: ReturnType<typeof detectChecks> = []
        let problem: string | null = null
        try { detected = detectChecks(project.root) } catch (error) { problem = `.hydra/checks.json is invalid: ${errorMessage(error)}` }
        const current = project.checks ? checksFor(project, project.root) : { source: detected.some((c) => c.id.startsWith('custom:')) ? 'file' as const : 'detected' as const, checks: detected }
        return { ...current, detected, problem }
      }
      case 'project.checks.set': {
        const project = this.store.getProject(command.projectId)
        if (!project) throw notFound('Project')
        for (const check of command.checks ?? []) {
          const { errors } = validateCheck(check)
          if (errors.length) throw invalid(`${check.label}: ${errors.join(' ')}`)
        }
        this.store.putProject({ ...project, checks: command.checks })
        this.store.audit(actorLabel, 'project.checks.set', { projectId: project.id, count: command.checks?.length ?? null })
        return null
      }
      case 'project.checks.test': return this.testCheck(command.projectId, command.check, actorLabel)
      case 'task.create': {
        const task = await this.createTask(command)
        this.store.audit(actorLabel, 'task.create', { taskId: task.id, mode: task.mode, assignment: task.assignment })
        return task
      }
      case 'remote.enable':
        if (!this.hooks.remoteEnable) throw unavailable('Phone access is not available in this host')
        await this.hooks.remoteEnable(command.minutes, command.host)
        this.store.audit(actorLabel, 'remote.enable', { minutes: command.minutes, host: command.host ?? null })
        return this.hooks.remoteStatus?.() ?? null
      case 'remote.disable':
        await this.hooks.remoteDisable?.()
        this.store.audit(actorLabel, 'remote.disable', {})
        return null
      case 'agents.recommend': {
        const route = routeRequest(command.prompt ?? '', command.depth ?? 'auto')
        const intent = route.depth === 'deep' ? 'change' as const : 'analyze' as const
        const ready = this.ctx.registry.ids().filter((id) => this.ctx.registry.usable(id))
        return recommend(categoryOf({ intent, route }), ready, this.store.listOutcomes(categoryOf({ intent, route })))
      }
      case 'outcomes.get': {
        const all = this.store.listOutcomes()
        const byCategory: Record<string, number> = {}
        for (const o of all) byCategory[o.category] = (byCategory[o.category] ?? 0) + 1
        return { count: all.length, byCategory }
      }
      case 'update.check':
        // No release key or address is configured until the owner sets up signed releases.
        return checkForUpdate({ manifestUrl: process.env.HYDRA_UPDATE_URL ?? null, publicKeyHex: process.env.HYDRA_UPDATE_KEY ?? null, currentVersion: this.version, platform: `${process.platform}-${process.arch}` })
      case 'outcomes.clear': {
        const removed = this.store.clearOutcomes()
        this.store.audit(actorLabel, 'outcomes.clear', { removed })
        return { removed }
      }
      case 'agent.prewarm': {
        const project = this.store.getProject(command.projectId)
        if (!project) throw notFound('Project')
        if (this.ctx.registry.usable('claude')) this.ctx.registry.get('claude').prewarm?.(project.root)
        return null
      }
      case 'task.cancel': this.requireTask(command.taskId); this.store.audit(actorLabel, 'task.cancel', { taskId: command.taskId }); return this.orchestrator.cancel(command.taskId)
      case 'task.resume': this.requireTask(command.taskId); this.orchestrator.resume(command.taskId); return null
      case 'task.approve_plan': this.requireTask(command.taskId); this.orchestrator.approvePlan(command.taskId, command.approve, command.note, source); return null
      case 'task.decide': this.requireTask(command.taskId); this.orchestrator.decide(command.taskId, command.decision, command.feedback, command.headSha, source, command.acceptance, actorLabel); return null
      case 'task.rollback': this.requireTask(command.taskId); return this.orchestrator.rollback(command.taskId, source)
      case 'task.delete': return this.deleteTask(command.taskId, actorLabel)
      case 'task.archive': {
        const root = this.requireTask(command.taskId)
        // A conversation is archived as a whole: the task, what it follows up on, and its follow-ups.
        const all = this.store.listTasks(root.projectId)
        const exists = new Set(all.map((t) => t.id))
        const ids = new Set<string>([root.id])
        for (let changed = true; changed;) {
          changed = false
          for (const t of all) {
            // Only tasks that still exist: a deleted earlier message must not abort the batch halfway.
            if (ids.has(t.id) && t.followUpOf && exists.has(t.followUpOf) && !ids.has(t.followUpOf)) { ids.add(t.followUpOf); changed = true }
            if (t.followUpOf && ids.has(t.followUpOf) && !ids.has(t.id)) { ids.add(t.id); changed = true }
          }
        }
        if ([...ids].some((id) => this.orchestrator.isRunning(id))) throw conflict('Stop the running task before archiving it')
        const at = command.archived ? isoNow() : null
        for (const id of ids) updateTask(this.ctx, id, (t) => { t.archivedAt = at })
        this.store.audit(actorLabel, command.archived ? 'task.archive' : 'task.restore', { taskIds: [...ids] })
        return { count: ids.size }
      }
      case 'device.pair_start':
        if (!this.hooks.pairStart) throw unavailable('Remote pairing is not available in this host')
        this.store.audit(actorLabel, 'device.pair_start', { name: command.name, scopes: command.scopes })
        return this.hooks.pairStart(command.name, command.scopes, command.host)
      case 'device.revoke':
        if (!this.hooks.revokeDevice) throw unavailable('Remote control is not available in this host')
        this.store.audit(actorLabel, 'device.revoke', { deviceId: command.deviceId })
        return this.hooks.revokeDevice(command.deviceId)
      case 'providers.refresh': return this.refreshProviders()
    }
  }

  private requireTask(taskId: string): Task {
    const task = this.store.getTask(taskId)
    if (!task) throw notFound('Task')
    return task
  }

  /** Runs one check now, on a throwaway copy of the project's last commit, with the usual limits. */
  private async testCheck(projectId: string, check: Parameters<typeof validateCheck>[0], actorLabel: string) {
    const project = this.store.getProject(projectId)
    if (!project) throw notFound('Project')
    const { errors, warnings } = validateCheck(check)
    if (errors.length) throw invalid(errors.join(' '))
    const head = (await isRepository(project.root)) ? await headSha(project.root) : null
    if (!head) throw invalid('Testing a check needs a git repository with at least one commit.')
    this.store.audit(actorLabel, 'project.checks.test', { projectId, argv: check.argv })
    const [spec] = specsFromDrafts([check])
    const { result } = await this.ctx.workspaces.withCheckout(project.root, head, (dir) => runChecks([spec!], {
      taskId: 'check-tests', workspacePath: dir, commitSha: head, phase: 'verify',
      logsDir: join(this.ctx.paths.logs, 'check-tests'), scratchDir: join(this.ctx.paths.scratch, 'check-tests'),
      signal: AbortSignal.timeout((spec!.timeoutSec + 30) * 1000)
    }))
    const e = result[0]!
    return { passed: e.exitCode === 0 && !e.timedOut && !e.spawnError, exitCode: e.exitCode, timedOut: e.timedOut, spawnError: e.spawnError, durationMs: e.durationMs, outputTail: e.outputTail.slice(-4000), warnings, commit: head.slice(0, 10) }
  }

  private async addProject(rootInput: string, name?: string): Promise<Project> {
    const root = validateProjectRoot(rootInput, this.ctx.paths.dataDir)
    const existing = this.store.listProjects().find((p) => (process.platform === 'win32' ? p.root.toLowerCase() === root.toLowerCase() : p.root === root))
    if (existing) return existing
    const project: Project = { id: newId(), name: name ?? basename(root), root, isGit: await isRepository(root), addedAt: isoNow(), checks: null }
    this.store.putProject(project)
    return project
  }

  private async createTask(command: Extract<Command, { type: 'task.create' }>): Promise<Task> {
    const project = this.store.getProject(command.projectId)
    if (!project) throw notFound('Project')
    if (!existsSync(project.root)) throw conflict(`Project folder is missing: ${project.root}`)
    // Route: the user's explicit choice, the legacy intent field, or Hydra's own classification.
    let route: Route = routeRequest(command.prompt, command.depth ?? (command.intent === 'change' ? 'deep' : command.intent === 'analyze' ? 'standard' : 'auto'))
    // Only changes need git; skip the check (two git processes) for answers.
    if (route.depth === 'deep' && !((await isRepository(project.root)) && Boolean(await headSha(project.root)))) {
      if (!route.auto) throw invalid('Changes need a git repository with at least one commit so work can be isolated. Run `git init` and commit, or ask a question instead.')
      route = { ...route, depth: 'standard', reason: 'This folder is not a git repository with commits, so Hydra can only answer here.' }
    }
    const intent = route.depth === 'deep' ? 'change' as const : 'analyze' as const
    // High-risk changes always stop for plan approval, whatever mode was requested.
    const mode = intent === 'change' && route.risk === 'high' ? 'safe' as const : command.mode
    let followUpOf: string | null = null
    if (command.followUpOf) {
      const previous = this.store.getTask(command.followUpOf)
      if (!previous || previous.projectId !== project.id || previous.intent !== 'analyze') throw invalid('Follow-ups continue a question in the same project')
      followUpOf = previous.id
    }
    const roles = intent === 'analyze' ? [command.assignment.planner] : [command.assignment.planner, command.assignment.implementer, command.assignment.reviewer]
    for (const provider of new Set(roles)) {
      if (!this.ctx.registry.has(provider)) throw unavailable(`${provider} is not available in this build`)
      if (!this.ctx.registry.usable(provider)) {
        const status = this.ctx.registry.status().find((s) => s.id === provider)
        throw unavailable(`${status?.displayName ?? provider} is not ready: ${status?.problems.join(' ') || 'not installed'}`)
      }
    }
    const budget = Budget.parse({ ...policyFor(mode).defaultBudget, ...command.budget })
    const selection = this.selectionFor(intent, route, command.assignment)
    const firstLine = command.prompt.split(/\r?\n/).find((line) => line.trim()) ?? command.prompt
    const now = isoNow()
    const task: Task = {
      id: newId(), projectId: project.id, title: (command.title || firstLine).trim().slice(0, 120), prompt: command.prompt,
      sourceContext: { projectRoot: project.root, runtimeVersion: this.version },
      intent, route, followUpOf, archivedAt: null, mode, assignment: command.assignment, selection, budget,
      status: 'queued', stage: 'plan', waitReason: null, outcome: null, fixRound: 0,
      plan: null, review: null, checks: [], checksApproved: !policyFor(mode).requireCheckApproval, checkDigest: null, applyIntent: null, demo: null, answer: null,
      workspace: null, applied: null, usage: emptyUsage(), stages: [], feedback: [], error: null, createdAt: now, updatedAt: now
    }
    this.store.putTask(task)
    this.orchestrator.begin(task.id)
    return task
  }

  /**
   * Records why these agents were chosen, by comparing them with Hydra's own recommendation
   * for the same request. Only the roles the task uses are compared.
   */
  private selectionFor(intent: 'change' | 'analyze', route: Route, assignment: Task['assignment']): Task['selection'] {
    const category = categoryOf({ intent, route })
    const ready = this.ctx.registry.ids().filter((id) => this.ctx.registry.usable(id))
    const advice = recommend(category, ready, this.store.listOutcomes(category))
    const roles = intent === 'analyze' ? (['planner'] as const) : (['planner', 'implementer', 'reviewer'] as const)
    const same = roles.every((role) => advice.assignment[role] === assignment[role])
    return { basis: same ? 'suggested' : 'yours', reason: advice.reason.slice(0, 400), suggested: same ? null : advice.assignment }
  }

  private async deleteTask(taskId: string, actorLabel: string): Promise<null> {
    const task = this.requireTask(taskId)
    if (this.orchestrator.isRunning(taskId)) throw conflict('Cancel the task before deleting it')
    const root = this.store.getProject(task.projectId)?.root
    if (root && task.workspace && !task.workspace.removed) {
      if (task.outcome === 'kept_branch') await this.ctx.workspaces.release(root, task.workspace)
      else await this.ctx.workspaces.discard(root, task.workspace)
    }
    rmSync(join(this.ctx.paths.logs, taskId), { recursive: true, force: true })
    rmSync(join(this.ctx.paths.scratch, taskId), { recursive: true, force: true })
    this.store.audit(actorLabel, 'task.delete', { taskId })
    // Keep the rest of the conversation connected: follow-ups now continue from the message before this one.
    for (const t of this.store.listTasks(task.projectId)) {
      if (t.followUpOf === taskId) updateTask(this.ctx, t.id, (draft) => { draft.followUpOf = task.followUpOf })
    }
    this.store.deleteTask(taskId)
    return null
  }

  /** Online, consistent copy of the database. Keeps the newest `keep` backups. */
  backup(keep = 7): string {
    const file = join(this.ctx.paths.backups, `hydra-${isoNow().replace(/[:.]/g, '-')}.db`)
    this.store.backupTo(file)
    ownerOnly(file, 0o600)
    const all = readdirSync(this.ctx.paths.backups).filter((f) => /^hydra-.*\.db$/.test(f)).sort()
    for (const old of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(this.ctx.paths.backups, old), { force: true })
    return file
  }

  /**
   * Portable JSON copy of the user's projects, tasks, runs, evidence and audit trail.
   * Secrets are left out: the remote identity key and device public keys stay in the database.
   */
  exportData(): string {
    const file = join(this.ctx.paths.backups, `hydra-export-${isoNow().replace(/[:.]/g, '-')}.json`)
    const tasks = this.store.listTasks().map((task) => ({ ...task, runs: this.store.listRuns(task.id), evidence: this.store.listEvidence(task.id) }))
    const data = {
      format: 'hydra-export', formatVersion: 1, engineVersion: this.version, schemaVersion: this.store.schemaVersion, exportedAt: isoNow(),
      projects: this.store.listProjects(), tasks, devices: this.store.listDevices(), audit: this.store.listAudit(100_000)
    }
    writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 })
    ownerOnly(file, 0o600)
    return file
  }

  log(taskId: string, level: 'info' | 'warn' | 'error', message: string): void {
    logTask(this.ctx, taskId, level, message)
  }

  async close(): Promise<void> {
    await this.orchestrator.shutdown()
    await this.ctx.registry.dispose()
    this.store.close()
    this.lock.release()
  }
}
