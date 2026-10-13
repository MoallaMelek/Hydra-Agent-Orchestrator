import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  Budget, Command, emptyUsage, PROTOCOL_VERSION, REMOTE_COMMAND_SCOPE,
  type CommandAck, type DeviceScope, type EngineSnapshot, type EventEnvelope, type Project, type Task, type TaskDetail, type TaskDiff
} from '@hydra/protocol'
import { AdapterRegistry } from './agents/registry.js'
import { headSha, isRepository } from './isolation/git.js'
import { validateProjectRoot } from './isolation/roots.js'
import { WorkspaceManager } from './isolation/workspace.js'
import { enginePaths, type EngineContext, logTask, Semaphore } from './orchestrator/context.js'
import { Orchestrator } from './orchestrator/orchestrator.js'
import { Store } from './store/store.js'
import { conflict, errorMessage, forbidden, HydraError, invalid, notFound, unavailable } from './util/errors.js'
import { isoNow, newId } from './util/ids.js'
import { policyFor } from './workflow/policy.js'

export type Actor = { kind: 'desktop' } | { kind: 'remote'; deviceId: string; scopes: readonly DeviceScope[] }

/** Hooks implemented by the host (hydrad) for features that live outside the engine. */
export interface HostHooks {
  pairStart?(name: string, scopes: DeviceScope[]): Promise<unknown>
  revokeDevice?(deviceId: string): Promise<unknown>
  remoteStatus?(): { relayUrl: string | null; connected: boolean }
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

  private constructor(options: EngineOptions) {
    const paths = enginePaths(options.dataDir)
    for (const dir of [paths.dataDir, paths.worktrees, paths.logs, paths.scratch, paths.backups]) mkdirSync(dir, { recursive: true })
    this.store = new Store(paths.database)
    this.version = options.version ?? '2.0.0-alpha.0'
    this.hooks = options.hooks ?? {}
    this.ctx = {
      store: this.store,
      registry: options.registry ?? AdapterRegistry.production(options.env),
      workspaces: new WorkspaceManager(paths.worktrees),
      paths,
      agentSlots: new Semaphore(options.maxConcurrentAgents ?? 3),
      env: options.env ?? process.env
    }
    this.orchestrator = new Orchestrator(this.ctx)
  }

  static async open(options: EngineOptions): Promise<Engine> {
    const engine = new Engine(options)
    const interrupted = engine.orchestrator.recover()
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
      tasks: this.store.listTasks(),
      providers: this.ctx.registry.status(),
      devices: this.store.listDevices(),
      remote: this.hooks.remoteStatus?.() ?? { relayUrl: null, connected: false }
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
    try {
      if (actor.kind === 'remote') {
        const required = REMOTE_COMMAND_SCOPE[command.type]
        if (!required) throw forbidden(`${command.type} is only available on the desktop`)
        if (!actor.scopes.includes(required)) throw forbidden(`This device lacks the "${required}" permission`)
      }
      const result = await this.dispatch(command, actor)
      return { ok: true, result: result ?? null }
    } catch (error) {
      if (error instanceof HydraError) return { ok: false, error: { code: error.code, message: error.message } }
      return { ok: false, error: { code: 'internal', message: errorMessage(error) } }
    }
  }

  private async dispatch(command: Command, actor: Actor): Promise<unknown> {
    const source = actor.kind === 'remote' ? 'remote' : 'desktop'
    const actorLabel = actor.kind === 'remote' ? `device:${actor.deviceId}` : 'desktop'
    switch (command.type) {
      case 'project.add': return this.addProject(command.root, command.name)
      case 'project.remove': {
        if (this.store.listTasks(command.projectId).some((t) => this.orchestrator.isRunning(t.id) || t.status === 'waiting_input')) {
          throw conflict('Finish or cancel this project\'s active tasks first')
        }
        this.store.deleteProject(command.projectId)
        return null
      }
      case 'task.create': {
        const task = await this.createTask(command)
        this.store.audit(actorLabel, 'task.create', { taskId: task.id, mode: task.mode, assignment: task.assignment })
        return task
      }
      case 'task.cancel': this.requireTask(command.taskId); this.store.audit(actorLabel, 'task.cancel', { taskId: command.taskId }); return this.orchestrator.cancel(command.taskId)
      case 'task.resume': this.requireTask(command.taskId); this.orchestrator.resume(command.taskId); return null
      case 'task.approve_plan': this.requireTask(command.taskId); this.orchestrator.approvePlan(command.taskId, command.approve, command.note, source); return null
      case 'task.decide': this.requireTask(command.taskId); this.orchestrator.decide(command.taskId, command.decision, command.feedback, source); return null
      case 'task.rollback': this.requireTask(command.taskId); return this.orchestrator.rollback(command.taskId, source)
      case 'task.delete': return this.deleteTask(command.taskId, actorLabel)
      case 'device.pair_start':
        if (!this.hooks.pairStart) throw unavailable('Remote pairing is not available in this host')
        this.store.audit(actorLabel, 'device.pair_start', { name: command.name, scopes: command.scopes })
        return this.hooks.pairStart(command.name, command.scopes)
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

  private async addProject(rootInput: string, name?: string): Promise<Project> {
    const root = validateProjectRoot(rootInput, this.ctx.paths.dataDir)
    const existing = this.store.listProjects().find((p) => (process.platform === 'win32' ? p.root.toLowerCase() === root.toLowerCase() : p.root === root))
    if (existing) return existing
    const project: Project = { id: newId(), name: name ?? basename(root), root, isGit: await isRepository(root), addedAt: isoNow() }
    this.store.putProject(project)
    return project
  }

  private async createTask(command: Extract<Command, { type: 'task.create' }>): Promise<Task> {
    const project = this.store.getProject(command.projectId)
    if (!project) throw notFound('Project')
    if (!existsSync(project.root)) throw conflict(`Project folder is missing: ${project.root}`)
    if (command.intent === 'change') {
      if (!(await isRepository(project.root))) throw invalid('Change tasks need a git repository so work can be isolated. Run `git init` and commit, or use an analysis task.')
      if (!(await headSha(project.root))) throw invalid('The repository has no commits yet. Make an initial commit first.')
    }
    const roles = command.intent === 'analyze' ? [command.assignment.planner] : [command.assignment.planner, command.assignment.implementer, command.assignment.reviewer]
    for (const provider of new Set(roles)) {
      if (!this.ctx.registry.has(provider)) throw unavailable(`${provider} is not available in this build`)
      if (!this.ctx.registry.usable(provider)) {
        const status = this.ctx.registry.status().find((s) => s.id === provider)
        throw unavailable(`${status?.displayName ?? provider} is not ready: ${status?.problems.join(' ') || 'not installed'}`)
      }
    }
    const budget = Budget.parse({ ...policyFor(command.mode).defaultBudget, ...command.budget })
    const firstLine = command.prompt.split(/\r?\n/).find((line) => line.trim()) ?? command.prompt
    const now = isoNow()
    const task: Task = {
      id: newId(), projectId: project.id, title: (command.title || firstLine).trim().slice(0, 120), prompt: command.prompt,
      intent: command.intent, mode: command.mode, assignment: command.assignment, budget,
      status: 'queued', stage: 'plan', waitReason: null, outcome: null, fixRound: 0,
      plan: null, review: null, checks: [], checksApproved: !policyFor(command.mode).requireCheckApproval, demo: null, answer: null,
      workspace: null, applied: null, usage: emptyUsage(), stages: [], feedback: [], error: null, createdAt: now, updatedAt: now
    }
    this.store.putTask(task)
    this.orchestrator.start(task.id, { kind: 'run', stage: 'plan' })
    return task
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
    this.store.deleteTask(taskId)
    return null
  }

  /** Online, consistent copy of the database. Keeps the newest `keep` backups. */
  backup(keep = 7): string {
    const file = join(this.ctx.paths.backups, `hydra-${isoNow().replace(/[:.]/g, '-')}.db`)
    this.store.backupTo(file)
    const all = readdirSync(this.ctx.paths.backups).filter((f) => /^hydra-.*\.db$/.test(f)).sort()
    for (const old of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(this.ctx.paths.backups, old), { force: true })
    return file
  }

  log(taskId: string, level: 'info' | 'warn' | 'error', message: string): void {
    logTask(this.ctx, taskId, level, message)
  }

  async close(): Promise<void> {
    await this.orchestrator.shutdown()
    this.store.close()
  }
}
