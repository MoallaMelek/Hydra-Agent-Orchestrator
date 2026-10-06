import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { timingSafeEqual } from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { unlinkSync, existsSync } from 'fs'
import { homedir } from 'os'
import { spawn as ptySpawn, type IPty } from 'node-pty'
import { AgentManager } from '../agents/AgentManager'
import { MAX_CONCURRENT_AGENTS_HARD_LIMIT } from '@shared/types'
import type { ConfigStore } from '../config/ConfigStore'
import type { SessionCatalog } from '../sessions/SessionCatalog'
import type { CodexSessionCatalog } from '../sessions/CodexSessionCatalog'
import type { HeadlessOrchestrator } from '../headless/HeadlessOrchestrator'
import type { WorkspaceStore } from '../workspace/WorkspaceStore'
import type { DaemonNotificationService } from './DaemonNotificationService'
import type { HydraMcpServer } from '../mcp/McpServer'
import type { SkillScanner } from '../skills/SkillScanner'
import { readTranscriptHistory } from '../sessions/TranscriptReader'
import { canonicalProjectRoot, resolveContainedExistingPath } from '../security/pathPolicy'
import type { WsServerMessage } from './protocol'
import { z, ZodError } from 'zod'
import type { TaskCoordinator } from '../tasks/TaskCoordinator'
import { createTaskSchema, taskCommandSchema } from '../tasks/taskSchemas'
import {
  broadcastSchema,
  configPatchSchema,
  createAgentSchema,
  freeTerminalActivateSchema,
  freeTerminalInputSchema,
  freeTerminalResizeSchema,
  freeTerminalSpawnSchema,
  headlessQuerySchema,
  headlessStartSchema,
  idSchema,
  inputSchema,
  logQuerySchema,
  modelUpdateSchema,
  notificationQuerySchema,
  preflightSchema,
  rawInputSchema,
  renameSchema,
  resizeSchema,
  searchParamsToObject,
  sessionQuerySchema,
  skillToggleSchema,
  terminalIdSchema,
  terminalInputSchema,
  terminalResizeSchema,
  yoloSchema
} from './requestSchemas'
import type {
  AgentOutputPayload,
  AgentStatusPayload,
  HydraNotification,
  FreeTerminalLayout,
  FreeTerminalGroup
} from '@shared/types'

/** Return the appropriate shell and args for the current platform. */
function getShellConfig(): { shell: string; shellArgs: string[] } {
  if (process.platform === 'win32') {
    const shell = process.env.COMSPEC || 'powershell.exe'
    // PowerShell uses -NoExit; cmd.exe uses /k — detect which one we have
    const isPowerShell = /powershell|pwsh/i.test(shell)
    return { shell, shellArgs: isPowerShell ? ['-NoExit'] : ['/k'] }
  }
  const shell = process.env.SHELL || '/bin/bash'
  return { shell, shellArgs: ['-l', '-i'] }
}

interface FreeTerminalEntry {
  id: string
  projectDir: string
  label: string
  pty: IPty
  buffer: string[]
  bufferLen: number
  lastActivityAt: number
  lastInputAt: number
  exited: boolean
}

interface ProjectTerminalState {
  groups: FreeTerminalGroup[]
  activeGroupId: string | null
  nextLabel: number
}

interface DaemonServerOptions {
  socketPath: string
  agentManager: AgentManager
  configStore: ConfigStore
  sessionCatalog: SessionCatalog
  codexSessionCatalog: CodexSessionCatalog
  headlessOrchestrator: HeadlessOrchestrator
  taskCoordinator?: TaskCoordinator
  workspaceStore: WorkspaceStore
  notificationService: DaemonNotificationService
  mcpServer: HydraMcpServer | null
  skillScanner: SkillScanner
  authToken: string
  onShutdown: () => void
}

const MAX_WEBSOCKET_CLIENTS = 8
const MAX_REQUEST_BODY_BYTES = 1024 * 1024

export function hasValidBearerToken(
  authorization: string | string[] | undefined,
  expectedToken: string
): boolean {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false
  const supplied = Buffer.from(authorization.slice('Bearer '.length), 'utf8')
  const expected = Buffer.from(expectedToken, 'utf8')
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export class DaemonServer {
  private readonly outputFlushIntervalMs = 16
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private readonly socketPath: string
  private readonly agentManager: AgentManager
  private readonly configStore: ConfigStore
  private readonly sessionCatalog: SessionCatalog
  private readonly codexSessionCatalog: CodexSessionCatalog
  private readonly headlessOrchestrator: HeadlessOrchestrator
  private readonly workspaceStore: WorkspaceStore
  private readonly notificationService: DaemonNotificationService
  private readonly mcpServer: HydraMcpServer | null
  private readonly skillScanner: SkillScanner
  private readonly authToken: string
  private readonly onShutdown: () => void
  private readonly startedAt = Date.now()
  private testPty: IPty | null = null
  private freeTerminals = new Map<string, FreeTerminalEntry>()
  private projectLayouts = new Map<string, ProjectTerminalState>()
  private freeIdleTimer: ReturnType<typeof setInterval> | null = null
  private pendingAgentOutput = new Map<string, string>()
  private outputFlushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: DaemonServerOptions) {
    this.socketPath = options.socketPath
    this.agentManager = options.agentManager
    this.configStore = options.configStore
    this.sessionCatalog = options.sessionCatalog
    this.codexSessionCatalog = options.codexSessionCatalog
    this.headlessOrchestrator = options.headlessOrchestrator
    this.workspaceStore = options.workspaceStore
    this.notificationService = options.notificationService
    this.mcpServer = options.mcpServer
    this.skillScanner = options.skillScanner
    this.authToken = options.authToken
    this.onShutdown = options.onShutdown
    options.taskCoordinator?.on('changed', payload => this.broadcast({ type: 'task:changed', payload }))
    options.taskCoordinator?.on('activity', payload => this.broadcast({ type: 'task:activity', payload }))
    options.taskCoordinator?.on('text', payload => this.broadcast({ type: 'task:text', payload }))
    this.taskCoordinator = options.taskCoordinator
  }

  private readonly taskCoordinator?: TaskCoordinator

  async start(): Promise<void> {
    // Remove stale socket file (not needed for Windows named pipes)
    if (!this.socketPath.startsWith('\\\\.\\pipe\\') && existsSync(this.socketPath)) {
      try { unlinkSync(this.socketPath) } catch { /* ignore */ }
    }

    this.server = createServer((req, res) => this.handleRequest(req, res))
    this.wss = new WebSocketServer({
      server: this.server,
      verifyClient: ({ req }, done) => {
        if (!hasValidBearerToken(req.headers.authorization, this.authToken)) {
          done(false, 401, 'Unauthorized')
          return
        }
        if ((this.wss?.clients.size ?? 0) >= MAX_WEBSOCKET_CLIENTS) {
          done(false, 503, 'Too many connections')
          return
        }
        done(true)
      }
    })

    this.wss.on('connection', (ws) => {
      ws.on('message', (raw) => {
        try {
          const msg = z.object({ type: z.literal('ping') }).strict().parse(JSON.parse(raw.toString()))
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }))
          }
        } catch { /* ignore bad messages */ }
      })
    })

    // Forward agent events over WebSocket
    this.agentManager.on('output', (payload: AgentOutputPayload) => {
      this.queueAgentOutput(payload)
    })

    this.agentManager.on('status', (payload: AgentStatusPayload) => {
      this.flushPendingAgentOutput()
      this.persistWorkspace()
      this.broadcast({ type: 'agent:status', payload })
    })

    this.agentManager.on('agent_waiting', (payload: { agentId: string }) => {
      this.broadcast({ type: 'agent:waiting', payload })
    })

    // Forward headless events
    this.headlessOrchestrator.on('event', (payload: { runId: string; data: string }) => {
      this.broadcast({ type: 'headless:event', payload })
    })

    // Forward notifications
    this.notificationService.subscribe((notification: HydraNotification) => {
      this.broadcast({ type: 'notification', payload: notification })
    })

    return new Promise((resolve, reject) => {
      this.server!.on('error', reject)
      this.server!.listen(this.socketPath, () => {
        console.log(`[daemon] HTTP+WS server listening on ${this.socketPath}`)
        resolve()
      })
    })
  }

  private killTestPty(): void {
    if (this.testPty) {
      try { this.testPty.kill() } catch { /* already dead */ }
      this.testPty = null
    }
  }

  private getProjectState(projectDir: string): ProjectTerminalState {
    let state = this.projectLayouts.get(projectDir)
    if (!state) {
      state = { groups: [], activeGroupId: null, nextLabel: 1 }
      this.projectLayouts.set(projectDir, state)
    }
    return state
  }

  private buildLayout(projectDir: string): FreeTerminalLayout {
    const state = this.getProjectState(projectDir)
    const panes = [] as FreeTerminalLayout['panes']
    for (const group of state.groups) {
      for (const paneId of group.paneIds) {
        const entry = this.freeTerminals.get(paneId)
        if (entry) panes.push({ id: entry.id, label: entry.label, exited: entry.exited })
      }
    }
    return {
      projectDir,
      groups: state.groups.map((g) => ({ id: g.id, paneIds: [...g.paneIds], activePaneId: g.activePaneId })),
      activeGroupId: state.activeGroupId,
      panes
    }
  }

  private broadcastLayout(projectDir: string): void {
    this.broadcast({
      type: 'free-terminal:layout-changed',
      payload: { projectDir, layout: this.buildLayout(projectDir) }
    })
  }

  private removePaneFromLayout(entry: FreeTerminalEntry): { removedGroupId: string | null } {
    const state = this.projectLayouts.get(entry.projectDir)
    if (!state) return { removedGroupId: null }
    let removedGroupId: string | null = null
    for (const group of state.groups) {
      const idx = group.paneIds.indexOf(entry.id)
      if (idx >= 0) {
        group.paneIds.splice(idx, 1)
        if (group.activePaneId === entry.id) {
          group.activePaneId = group.paneIds[0] ?? ''
        }
        if (group.paneIds.length === 0) {
          removedGroupId = group.id
        }
        break
      }
    }
    if (removedGroupId) {
      state.groups = state.groups.filter((g) => g.id !== removedGroupId)
      if (state.activeGroupId === removedGroupId) {
        state.activeGroupId = state.groups[0]?.id ?? null
      }
    }
    if (state.groups.length === 0) {
      this.projectLayouts.delete(entry.projectDir)
    }
    return { removedGroupId }
  }

  private killFreeTerminal(terminalId: string): boolean {
    const entry = this.freeTerminals.get(terminalId)
    if (!entry) return false
    try { entry.pty.kill() } catch { /* already dead */ }
    const projectDir = entry.projectDir
    this.removePaneFromLayout(entry)
    this.freeTerminals.delete(terminalId)
    this.broadcastLayout(projectDir)
    return true
  }

  private killAllFreeTerminals(): void {
    for (const terminalId of Array.from(this.freeTerminals.keys())) {
      const entry = this.freeTerminals.get(terminalId)
      if (!entry) continue
      try { entry.pty.kill() } catch { /* already dead */ }
    }
    this.freeTerminals.clear()
    this.projectLayouts.clear()
  }

  /** Approximate char cap per terminal's ring buffer (≈200 chars/line). */
  private freeScrollbackCharCap(): number {
    const lines = Math.max(100, this.configStore.get().freeTerminalScrollbackLines || 5000)
    return lines * 200
  }

  private appendFreeBuffer(entry: FreeTerminalEntry, data: string): void {
    entry.buffer.push(data)
    entry.bufferLen += data.length
    const cap = this.freeScrollbackCharCap()
    if (entry.bufferLen > cap) {
      const full = entry.buffer.join('')
      const trimmed = full.slice(full.length - cap)
      entry.buffer = [trimmed]
      entry.bufferLen = trimmed.length
    }
  }

  private enforceFreeTerminalLru(): void {
    const cfg = this.configStore.get()
    if (cfg.freeTerminalLifecyclePolicy !== 'lru') return
    const cap = Math.max(1, cfg.freeTerminalMaxCount || 6)
    while (this.freeTerminals.size >= cap) {
      let oldestKey: string | null = null
      let oldestAt = Infinity
      for (const [key, entry] of this.freeTerminals.entries()) {
        if (entry.lastActivityAt < oldestAt) {
          oldestAt = entry.lastActivityAt
          oldestKey = key
        }
      }
      if (!oldestKey) break
      this.killFreeTerminal(oldestKey)
    }
  }

  private ensureFreeIdleTimer(): void {
    if (this.freeIdleTimer) return
    this.freeIdleTimer = setInterval(() => this.sweepIdleFreeTerminals(), 60_000)
  }

  private sweepIdleFreeTerminals(): void {
    const cfg = this.configStore.get()
    if (cfg.freeTerminalLifecyclePolicy !== 'idle') return
    const timeoutMs = Math.max(1, cfg.freeTerminalIdleTimeoutMinutes || 60) * 60_000
    const now = Date.now()
    for (const [terminalId, entry] of Array.from(this.freeTerminals.entries())) {
      if (now - entry.lastInputAt > timeoutMs) {
        this.killFreeTerminal(terminalId)
      }
    }
  }

  private generateTerminalId(): string {
    return `term-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  private generateGroupId(): string {
    return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  stop(): void {
    this.flushPendingAgentOutput()
    this.killTestPty()
    this.killAllFreeTerminals()
    if (this.freeIdleTimer) {
      clearInterval(this.freeIdleTimer)
      this.freeIdleTimer = null
    }
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close()
      }
      this.wss.close()
      this.wss = null
    }
    if (this.server) {
      this.server.close()
      this.server = null
    }
    // Clean up socket file (named pipes on Windows don't leave files)
    if (!this.socketPath.startsWith('\\\\.\\pipe\\') && existsSync(this.socketPath)) {
      try { unlinkSync(this.socketPath) } catch { /* ignore */ }
    }
  }

  private broadcast(message: WsServerMessage): void {
    if (!this.wss) return
    const data = JSON.stringify(message)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  private queueAgentOutput(payload: AgentOutputPayload): void {
    if (!payload.data) return
    this.pendingAgentOutput.set(
      payload.agentId,
      (this.pendingAgentOutput.get(payload.agentId) ?? '') + payload.data
    )
    if (this.outputFlushTimer) return
    this.outputFlushTimer = setTimeout(() => {
      this.outputFlushTimer = null
      this.flushPendingAgentOutput()
    }, this.outputFlushIntervalMs)
  }

  private flushPendingAgentOutput(): void {
    if (this.outputFlushTimer) {
      clearTimeout(this.outputFlushTimer)
      this.outputFlushTimer = null
    }
    if (this.pendingAgentOutput.size === 0) return

    const pending = this.pendingAgentOutput
    this.pendingAgentOutput = new Map()
    for (const [agentId, data] of pending.entries()) {
      this.broadcast({ type: 'agent:output', payload: { agentId, data } })
    }
  }

  private persistWorkspace(): void {
    try {
      this.workspaceStore.setAgents(this.agentManager.exportWorkspaceAgents())
    } catch {
      // Best-effort
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'http://localhost')
    const method = req.method || 'GET'
    const path = url.pathname

    if (!hasValidBearerToken(req.headers.authorization, this.authToken)) {
      return this.json(res, 401, { error: 'Unauthorized' })
    }

    try {
      if (path === '/tasks' && this.taskCoordinator) {
        if (method === 'GET') return this.json(res, 200, this.taskCoordinator.list())
        if (method === 'POST') return this.json(res, 201, await this.taskCoordinator.create(createTaskSchema.parse(await this.readBody(req))))
      }
      const taskMatch = path.match(/^\/tasks\/([a-f0-9-]{36})$/)
      if (taskMatch && this.taskCoordinator) {
        if (method === 'GET') return this.json(res, 200, this.taskCoordinator.get(taskMatch[1]))
        if (method === 'POST') return this.json(res, 200, await this.taskCoordinator.command(taskMatch[1], taskCommandSchema.parse(await this.readBody(req))))
      }
      // Health
      if (method === 'GET' && path === '/health') {
        return this.json(res, 200, {
          status: 'ok',
          pid: process.pid,
          uptime: Math.floor((Date.now() - this.startedAt) / 1000),
          agentCount: this.agentManager.list().length,
          version: '2.0.0'
        })
      }

      // Shutdown
      if (method === 'POST' && path === '/shutdown') {
        this.json(res, 200, { status: 'shutting_down' })
        setTimeout(() => this.onShutdown(), 100)
        return
      }

      // ── Agents ──────────────────────────────────────────────────────────
      if (method === 'GET' && path === '/agents') {
        return this.json(res, 200, this.agentManager.list())
      }

      if (method === 'POST' && path === '/agents') {
        const body = createAgentSchema.parse(await this.readBody(req))
        body.projectDir = await canonicalProjectRoot(body.projectDir)
        if (!body.name) {
          body.name = AgentManager.generateName(body.initialPrompt, body.projectDir)
        }
        const preflight = await this.agentManager.preflight(body.provider)
        if (!preflight.ok) {
          return this.json(res, 400, { error: preflight.error || 'Preflight failed' })
        }
        const maxAgents = Math.min(this.configStore.get().maxAgents, MAX_CONCURRENT_AGENTS_HARD_LIMIT)
        if (this.agentManager.activeCount() >= maxAgents) {
          return this.json(res, 400, { error: `Maximum concurrent agents (${maxAgents}) reached` })
        }
        const created = await this.agentManager.create(body)
        this.persistWorkspace()
        return this.json(res, 201, created)
      }

      // Agent by ID routes
      const agentMatch = path.match(/^\/agents\/([^/]+)$/)
      if (agentMatch) {
        const agentId = idSchema.parse(decodeURIComponent(agentMatch[1]))

        if (method === 'GET') {
          const agent = this.agentManager.get(agentId)
          if (!agent) return this.json(res, 404, { error: 'Agent not found' })
          return this.json(res, 200, agent)
        }

        if (method === 'DELETE') {
          const removed = await this.agentManager.remove(agentId)
          this.persistWorkspace()
          return this.json(res, 200, { removed })
        }
      }

      // Agent kill
      const killMatch = path.match(/^\/agents\/([^/]+)\/kill$/)
      if (method === 'POST' && killMatch) {
        const agentId = idSchema.parse(decodeURIComponent(killMatch[1]))
        const killed = this.agentManager.kill(agentId)
        this.persistWorkspace()
        return this.json(res, 200, { killed })
      }

      // Agent restart
      const restartMatch = path.match(/^\/agents\/([^/]+)\/restart$/)
      if (method === 'POST' && restartMatch) {
        const agentId = idSchema.parse(decodeURIComponent(restartMatch[1]))
        const restarted = this.agentManager.restart(agentId)
        this.persistWorkspace()
        return this.json(res, 200, restarted)
      }

      // Agent input
      const inputMatch = path.match(/^\/agents\/([^/]+)\/input$/)
      if (method === 'POST' && inputMatch) {
        const agentId = idSchema.parse(decodeURIComponent(inputMatch[1]))
        const body = inputSchema.parse(await this.readBody(req))
        this.agentManager.sendInput(agentId, body.input)
        return this.json(res, 200, { sent: true })
      }

      // Agent raw input
      const rawInputMatch = path.match(/^\/agents\/([^/]+)\/input-raw$/)
      if (method === 'POST' && rawInputMatch) {
        const agentId = idSchema.parse(decodeURIComponent(rawInputMatch[1]))
        const body = rawInputSchema.parse(await this.readBody(req))
        this.agentManager.sendRawInput(agentId, body.data)
        return this.json(res, 200, { sent: true })
      }

      // Agent resize
      const resizeMatch = path.match(/^\/agents\/([^/]+)\/resize$/)
      if (method === 'POST' && resizeMatch) {
        const agentId = idSchema.parse(decodeURIComponent(resizeMatch[1]))
        const body = resizeSchema.parse(await this.readBody(req))
        this.agentManager.resize(agentId, body.cols, body.rows)
        return this.json(res, 200, { resized: true })
      }

      // Agent rename
      const renameMatch = path.match(/^\/agents\/([^/]+)\/rename$/)
      if (method === 'POST' && renameMatch) {
        const agentId = idSchema.parse(decodeURIComponent(renameMatch[1]))
        const body = renameSchema.parse(await this.readBody(req))
        const renamed = this.agentManager.renameAgent(agentId, body.name)
        this.persistWorkspace()
        return this.json(res, 200, renamed)
      }

      // Agent model update
      const modelMatch = path.match(/^\/agents\/([^/]+)\/model$/)
      if (method === 'POST' && modelMatch) {
        const agentId = idSchema.parse(decodeURIComponent(modelMatch[1]))
        const body = modelUpdateSchema.parse(await this.readBody(req))
        const updated = this.agentManager.setModel(agentId, body.model)
        this.persistWorkspace()
        return this.json(res, 200, updated)
      }

      // Agent YOLO toggle
      const yoloMatch = path.match(/^\/agents\/([^/]+)\/yolo$/)
      if (method === 'POST' && yoloMatch) {
        const agentId = idSchema.parse(decodeURIComponent(yoloMatch[1]))
        const body = yoloSchema.parse(await this.readBody(req))
        const toggled = this.agentManager.toggleYolo(agentId, body.yolo)
        this.persistWorkspace()
        return this.json(res, 200, toggled)
      }

      // Agent output buffer
      const bufferMatch = path.match(/^\/agents\/([^/]+)\/buffer$/)
      if (method === 'GET' && bufferMatch) {
        const agentId = idSchema.parse(decodeURIComponent(bufferMatch[1]))
        const buffer = this.agentManager.getBuffer(agentId)
        return this.json(res, 200, { lines: buffer })
      }

      // Agent conversation history (from JSONL transcript)
      const historyMatch = path.match(/^\/agents\/([^/]+)\/history$/)
      if (method === 'GET' && historyMatch) {
        const agentId = idSchema.parse(decodeURIComponent(historyMatch[1]))
        const agent = this.agentManager.get(agentId)
        if (!agent) return this.json(res, 404, { error: 'Agent not found' })
        if (!agent.sessionId) return this.json(res, 200, { messages: [] })
        const messages = readTranscriptHistory(agent.sessionId, agent.provider)
        return this.json(res, 200, { messages })
      }

      // Broadcast
      if (method === 'POST' && path === '/broadcast') {
        const body = broadcastSchema.parse(await this.readBody(req))
        const sentTo = this.agentManager.broadcast(body.projectDir, body.input)
        return this.json(res, 200, { sentTo })
      }

      // ── Config ──────────────────────────────────────────────────────────
      if (method === 'GET' && path === '/config') {
        return this.json(res, 200, this.configStore.get())
      }

      if (method === 'PATCH' && path === '/config') {
        const body = configPatchSchema.parse(await this.readBody(req))
        const updated = this.configStore.set(body)
        this.broadcast({ type: 'config:changed', payload: updated })
        return this.json(res, 200, updated)
      }

      // ── Preflight ───────────────────────────────────────────────────────
      if (method === 'POST' && path === '/preflight') {
        const body = preflightSchema.parse(await this.readBody(req))
        const result = body.provider
          ? await this.agentManager.preflight(body.provider)
          : await this.agentManager.preflightAny()
        return this.json(res, 200, result)
      }

      // ── Sessions ────────────────────────────────────────────────────────
      if (method === 'GET' && path === '/sessions') {
        const config = this.configStore.get()
        const query = sessionQuerySchema.parse(searchParamsToObject(url.searchParams))
        const provider = query.provider
        const limit = query.limit ?? (config.sessionImportLimit > 0 ? config.sessionImportLimit : undefined)
        const maxAgeDays = query.maxAgeDays ?? (config.sessionMaxAgeDays > 0 ? config.sessionMaxAgeDays : undefined)
        const projectPathPrefix = query.projectPathPrefix ?? (config.sessionImportProjectPrefix || undefined)
        const catalog = provider === 'codex' ? this.codexSessionCatalog : this.sessionCatalog
        const sessions = catalog.listSessions({
          limit,
          maxAgeDays,
          projectPathPrefix,
          hiddenSessionIds: config.hiddenSessionIds
        })
        return this.json(res, 200, sessions)
      }

      // ── Headless ────────────────────────────────────────────────────────
      if (method === 'POST' && path === '/headless') {
        const body = headlessStartSchema.parse(await this.readBody(req))
        body.projectDir = await canonicalProjectRoot(body.projectDir)
        if (body.provider === 'opencode') return this.json(res, 400, { error: 'OpenCode headless permission confinement is not verified; use a supervised interactive Agent.' })
        const writing = body.accessMode === 'project-write'
        if (writing && (this.taskCoordinator?.ownsProject(body.projectDir) || this.agentManager.list().some(agent => ['running', 'starting'].includes(agent.status) && agent.projectDir.toLowerCase() === body.projectDir.toLowerCase()) || this.headlessOrchestrator.list().some(run => (run.status === 'running' || !!run.error?.startsWith('Cancellation failed:')) && run.accessMode === 'project-write' && run.projectDir.toLowerCase() === body.projectDir.toLowerCase()))) return this.json(res, 409, { error: 'This canonical project already has an active writer' })
        const sandbox = writing ? 'workspace-write' as const : 'read-only' as const
        const run = this.headlessOrchestrator.start({ ...body, sandbox })
        return this.json(res, 201, run)
      }

      if (method === 'GET' && path === '/headless') {
        const options = headlessQuerySchema.parse(searchParamsToObject(url.searchParams))
        const runs = this.headlessOrchestrator.list(options)
        return this.json(res, 200, runs)
      }

      const headlessMatch = path.match(/^\/headless\/([^/]+)$/)
      if (headlessMatch) {
        const runId = idSchema.parse(decodeURIComponent(headlessMatch[1]))
        if (method === 'GET') {
          const run = this.headlessOrchestrator.get(runId)
          if (!run) return this.json(res, 404, { error: 'Run not found' })
          return this.json(res, 200, run)
        }
        if (method === 'DELETE') {
          const canceled = this.headlessOrchestrator.cancel(runId)
          return this.json(res, 200, { canceled })
        }
      }

      const headlessLogMatch = path.match(/^\/headless\/([^/]+)\/log$/)
      if (method === 'GET' && headlessLogMatch) {
        const runId = idSchema.parse(decodeURIComponent(headlessLogMatch[1]))
        const options = logQuerySchema.parse(searchParamsToObject(url.searchParams))
        const log = this.headlessOrchestrator.getLog(runId, options)
        if (!log) return this.json(res, 404, { error: 'Run not found' })
        return this.json(res, 200, log)
      }

      // ── MCP ─────────────────────────────────────────────────────────────
      if (method === 'GET' && path === '/mcp/status') {
        const status = this.mcpServer?.getStatus() ?? { running: false, port: null, error: null, managerWorkspace: null }
        return this.json(res, 200, status)
      }

      // ── Notifications ───────────────────────────────────────────────────
      if (method === 'GET' && path === '/notifications') {
        const { limit } = notificationQuerySchema.parse(searchParamsToObject(url.searchParams))
        return this.json(res, 200, this.notificationService.getRecent(limit))
      }

      // ── Skills ────────────────────────────────────────────────────────
      if (method === 'GET' && path === '/skills') {
        return this.json(res, 200, this.skillScanner.scan())
      }

      if (method === 'POST' && path === '/skills/toggle') {
        const body = skillToggleSchema.parse(await this.readBody(req))
        const success = this.skillScanner.toggle(body)
        return this.json(res, 200, { success })
      }

      // ── Test Terminal ──────────────────────────────────────────────────
      if (method === 'POST' && path === '/test-terminal/spawn') {
        this.killTestPty()
        const { shell, shellArgs } = getShellConfig()
        const env: Record<string, string> = { ...process.env as Record<string, string>, TERM: 'xterm-256color', FORCE_COLOR: '1' }
        delete env.ELECTRON_RUN_AS_NODE
        this.testPty = ptySpawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: homedir(),
          env
        })
        this.testPty.onData((data: string) => {
          this.broadcast({ type: 'test-terminal:output', payload: { data } })
        })
        this.testPty.onExit(({ exitCode }) => {
          this.testPty = null
          this.broadcast({ type: 'test-terminal:exit', payload: { exitCode } })
        })
        return this.json(res, 200, { ok: true })
      }

      if (method === 'POST' && path === '/test-terminal/input') {
        const body = terminalInputSchema.parse(await this.readBody(req))
        this.testPty?.write(body.data)
        return this.json(res, 200, { ok: true })
      }

      if (method === 'POST' && path === '/test-terminal/resize') {
        const body = terminalResizeSchema.parse(await this.readBody(req))
        try { this.testPty?.resize(body.cols, body.rows) } catch { /* ignore */ }
        return this.json(res, 200, { ok: true })
      }

      if (method === 'POST' && path === '/test-terminal/kill') {
        this.killTestPty()
        return this.json(res, 200, { ok: true })
      }

      // ── Free Terminal (integrated shell, project-scoped, multi-pane) ────
      if (method === 'POST' && path === '/free-terminal/spawn') {
        const body = freeTerminalSpawnSchema.parse(await this.readBody(req))
        const resolvedTerminalPaths = await resolveContainedExistingPath(
          body.projectDir,
          body.cwd ?? '.'
        )
        const projectDir = resolvedTerminalPaths.root

        this.enforceFreeTerminalLru()

        const state = this.getProjectState(projectDir)
        const terminalId = this.generateTerminalId()
        const label = `Terminal ${state.nextLabel++}`

        const { shell, shellArgs } = getShellConfig()
        const env: Record<string, string> = { ...process.env as Record<string, string>, TERM: 'xterm-256color', FORCE_COLOR: '1' }
        delete env.ELECTRON_RUN_AS_NODE
        const pty = ptySpawn(shell, shellArgs, {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: resolvedTerminalPaths.path,
          env
        })
        const now = Date.now()
        const entry: FreeTerminalEntry = {
          id: terminalId,
          projectDir,
          label,
          pty,
          buffer: [],
          bufferLen: 0,
          lastActivityAt: now,
          lastInputAt: now,
          exited: false
        }
        this.freeTerminals.set(terminalId, entry)

        let targetGroup: FreeTerminalGroup | undefined
        if (body.groupId) {
          targetGroup = state.groups.find((g) => g.id === body.groupId)
        }
        if (!targetGroup) {
          targetGroup = { id: this.generateGroupId(), paneIds: [], activePaneId: terminalId }
          state.groups.push(targetGroup)
        }
        targetGroup.paneIds.push(terminalId)
        targetGroup.activePaneId = terminalId
        state.activeGroupId = targetGroup.id

        pty.onData((data: string) => {
          entry.lastActivityAt = Date.now()
          this.appendFreeBuffer(entry, data)
          this.broadcast({ type: 'free-terminal:output', payload: { terminalId, projectDir, data } })
        })
        pty.onExit(({ exitCode }) => {
          entry.exited = true
          this.removePaneFromLayout(entry)
          this.freeTerminals.delete(terminalId)
          this.broadcast({ type: 'free-terminal:exit', payload: { terminalId, projectDir, exitCode } })
          this.broadcastLayout(projectDir)
        })
        this.ensureFreeIdleTimer()
        this.broadcastLayout(projectDir)
        return this.json(res, 200, { ok: true, terminalId, groupId: targetGroup.id, layout: this.buildLayout(projectDir) })
      }

      if (method === 'POST' && path === '/free-terminal/input') {
        const body = freeTerminalInputSchema.parse(await this.readBody(req))
        const entry = this.freeTerminals.get(body.terminalId)
        if (entry) {
          entry.pty.write(body.data)
          entry.lastInputAt = Date.now()
          entry.lastActivityAt = Date.now()
        }
        return this.json(res, 200, { ok: true })
      }

      if (method === 'POST' && path === '/free-terminal/resize') {
        const body = freeTerminalResizeSchema.parse(await this.readBody(req))
        const entry = this.freeTerminals.get(body.terminalId)
        try { entry?.pty.resize(body.cols, body.rows) } catch { /* ignore */ }
        return this.json(res, 200, { ok: true })
      }

      if (method === 'POST' && path === '/free-terminal/kill') {
        const body = terminalIdSchema.parse(await this.readBody(req))
        const killed = this.killFreeTerminal(body.terminalId)
        return this.json(res, 200, { ok: true, killed })
      }

      if (method === 'POST' && path === '/free-terminal/activate') {
        const body = freeTerminalActivateSchema.parse(await this.readBody(req))
        const state = this.projectLayouts.get(body.projectDir)
        if (!state) return this.json(res, 200, { ok: true })
        if (body.groupId) {
          const group = state.groups.find((g) => g.id === body.groupId)
          if (group) {
            state.activeGroupId = group.id
            if (body.paneId && group.paneIds.includes(body.paneId)) {
              group.activePaneId = body.paneId
            }
          }
        }
        this.broadcastLayout(body.projectDir)
        return this.json(res, 200, { ok: true, layout: this.buildLayout(body.projectDir) })
      }

      if (method === 'GET' && path === '/free-terminal/buffer') {
        const terminalId = idSchema.parse(url.searchParams.get('terminalId'))
        const entry = this.freeTerminals.get(terminalId)
        if (!entry) return this.json(res, 200, { exists: false, data: '' })
        entry.lastActivityAt = Date.now()
        return this.json(res, 200, { exists: true, data: entry.buffer.join('') })
      }

      if (method === 'GET' && path === '/free-terminal/layout') {
        const projectDir = z.string().trim().min(1).max(4096).parse(url.searchParams.get('projectDir'))
        return this.json(res, 200, this.buildLayout(projectDir))
      }

      if (method === 'GET' && path === '/free-terminal/list') {
        const list = Array.from(this.freeTerminals.values()).map((e) => ({
          terminalId: e.id,
          projectDir: e.projectDir,
          label: e.label,
          lastActivityAt: e.lastActivityAt,
          lastInputAt: e.lastInputAt,
          exited: e.exited
        }))
        return this.json(res, 200, list)
      }

      // 404
      this.json(res, 404, { error: 'Not found' })
    } catch (err) {
      console.error(`[daemon] Request error ${method} ${path}:`, err)
      const status = err instanceof ZodError
        ? 400
        : err instanceof Error && err.message === 'Request body too large'
          ? 413
          : 500
      this.json(res, status, { error: err instanceof Error ? err.message : 'Internal error' })
    }
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private readBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let bytes = 0
      let tooLarge = false
      req.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > MAX_REQUEST_BODY_BYTES) {
          tooLarge = true
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (tooLarge) {
          reject(new Error('Request body too large'))
          return
        }
        try {
          const text = Buffer.concat(chunks).toString('utf-8')
          resolve(text ? JSON.parse(text) : {} as T)
        } catch {
          reject(new Error('Invalid JSON body'))
        }
      })
      req.on('error', reject)
    })
  }
}
