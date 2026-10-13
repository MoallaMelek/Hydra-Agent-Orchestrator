/**
 * Hydra Daemon — standalone Node.js process that owns all PTY sessions.
 *
 * Usage: node daemon.js [--socket-path <path>] [--user-data <path>] [--auth-token <token>]
 *
 * The daemon serves HTTP + WebSocket on a Unix domain socket.
 * Hydra (Electron) connects as a client. If the daemon isn't running,
 * Electron spawns it automatically.
 */

import { join } from 'path'
import { mkdirSync } from 'fs'
import { realpathSync } from 'fs'
import { homedir } from 'os'
import { AgentManager } from '../agents/AgentManager'
import { ConfigStore } from '../config/ConfigStore'
import { SessionCatalog } from '../sessions/SessionCatalog'
import { CodexSessionCatalog } from '../sessions/CodexSessionCatalog'
import { HeadlessOrchestrator } from '../headless/HeadlessOrchestrator'
import { WorkspaceStore } from '../workspace/WorkspaceStore'
import { DaemonNotificationService } from './DaemonNotificationService'
import { DaemonServer } from './DaemonServer'
import { writeLockFile, removeLockFile } from './lock'
import { HydraMcpServer } from '../mcp/McpServer'
import { SkillScanner } from '../skills/SkillScanner'
import { getDefaultModelForProvider } from '@shared/types'
import { fixPath } from '../util/fix-path'
import { buildSessionImportOptions } from './sessionImportOptions'
import { TaskCoordinator } from '../tasks/TaskCoordinator'
import { createTaskAdapters } from '../tasks/providerAdapters'

// ── Parse CLI args ────────────────────────────────────────────────────────────

function parseArgs(): { socketPath: string; userDataPath: string; lockPath: string; authToken: string } {
  const args = process.argv.slice(2)
  let socketPath = ''
  let userDataPath = ''
  let authToken = ''

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--socket-path' && args[i + 1]) {
      socketPath = args[++i]
    } else if (args[i] === '--user-data' && args[i + 1]) {
      userDataPath = args[++i]
    } else if (args[i] === '--auth-token' && args[i + 1]) {
      authToken = args[++i]
    }
  }

  if (!userDataPath) {
    userDataPath = join(homedir(), '.config', 'Hydra')
  }

  if (!socketPath) {
    socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\hydra-daemon-${userDataPath.replace(/[^a-zA-Z0-9]/g, '_')}`
      : join(userDataPath, 'daemon.sock')
  }

  const lockPath = join(userDataPath, 'daemon.lock')

  if (authToken.length < 32) {
    throw new Error('A strong daemon authentication token is required')
  }

  return { socketPath, userDataPath, lockPath, authToken }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { socketPath, userDataPath, lockPath, authToken } = parseArgs()

  mkdirSync(userDataPath, { recursive: true })

  // Fix PATH before anything tries to resolve CLI tools
  fixPath()

  console.log(`[daemon] Starting — PID ${process.pid}`)
  console.log(`[daemon] platform: ${process.platform}`)
  console.log(`[daemon] userDataPath: ${userDataPath}`)
  console.log(`[daemon] socketPath:   ${socketPath}`)
  console.log(`[daemon] PATH: ${process.env.PATH}`)

  // ── Instantiate services ────────────────────────────────────────────────

  const configStore = new ConfigStore(userDataPath)
  const workspaceStore = new WorkspaceStore(userDataPath)
  const sessionCatalog = new SessionCatalog()
  const codexSessionCatalog = new CodexSessionCatalog()
  const agentManager = new AgentManager(sessionCatalog, codexSessionCatalog)
  agentManager.setShellConfigProvider(() => {
    const c = configStore.get()
    return {
      mode: c.terminalShellMode,
      path: c.terminalShellPath,
      args: c.terminalShellArgs
    }
  })
  const headlessOrchestrator = new HeadlessOrchestrator(join(userDataPath, 'headless-runs'))
  const taskCoordinator = new TaskCoordinator(join(userDataPath, 'tasks'), createTaskAdapters(headlessOrchestrator, id => {
    const config = configStore.get()
    return config.defaultProvider === id ? config.defaultModel : null
  }))
  agentManager.setProjectWriteGuard(root => taskCoordinator.ownsProject(root) || headlessOrchestrator.list().some(run => {
    if (run.status !== 'running' && !run.error?.startsWith('Cancellation failed:')) return false
    if (run.accessMode !== 'project-write' && run.sandbox !== 'workspace-write') return false
    try { const path = realpathSync(run.projectDir); return process.platform === 'win32' ? path.toLowerCase() === root.toLowerCase() : path === root } catch { return true }
  }))
  taskCoordinator.setExternalWriterCheck(root => agentManager.list().some(agent => {
    if (!['running', 'starting'].includes(agent.status)) return false
    try { const path = realpathSync(agent.projectDir); return process.platform === 'win32' ? path.toLowerCase() === root.toLowerCase() : path === root } catch { return false }
  }) || headlessOrchestrator.list().some(run => (run.status === 'running' || !!run.error?.startsWith('Cancellation failed:')) && (run.accessMode === 'project-write' || run.sandbox === 'workspace-write') && (process.platform === 'win32' ? run.projectDir.toLowerCase() === root.toLowerCase() : run.projectDir === root)))
  const notificationService = new DaemonNotificationService()

  // Restore workspace agents
  const config = configStore.get()
  const restored = agentManager.hydrateWorkspaceAgents(workspaceStore.getAgents())
  if (restored > 0) {
    console.log(`[daemon] Restored ${restored} workspace agents`)
  }

  // Import sessions — each catalog dictates its own provider, so sessions
  // are always resumed with the CLI that originally created them (never
  // stamped with the user's defaultProvider, which would cause resume failures).
  if (config.importSessionsOnStartup) {
    const listOptions = buildSessionImportOptions(config)

    try {
      const claudeSessions = sessionCatalog.listSessions(listOptions)
      const importedClaude = agentManager.importSessions(
        claudeSessions,
        getDefaultModelForProvider('claude'),
        'claude'
      )
      if (importedClaude > 0) {
        console.log(`[daemon] Imported ${importedClaude} Claude sessions`)
      }
    } catch (err) {
      console.warn('[daemon] Failed to import Claude sessions:', err)
    }

    try {
      const codexSessions = codexSessionCatalog.listSessions(listOptions)
      const importedCodex = agentManager.importSessions(
        codexSessions,
        getDefaultModelForProvider('codex'),
        'codex'
      )
      if (importedCodex > 0) {
        console.log(`[daemon] Imported ${importedCodex} Codex sessions`)
      }
    } catch (err) {
      console.warn('[daemon] Failed to import Codex sessions:', err)
    }
  }
  workspaceStore.setAgents(agentManager.exportWorkspaceAgents())

  // Connect notifications to agent events
  notificationService.connectAgentEvents(agentManager, headlessOrchestrator)

  // Start MCP server
  let mcpServer: HydraMcpServer | null = null
  try {
    mcpServer = new HydraMcpServer(agentManager, userDataPath)
    mcpServer.setNotificationService(notificationService)
    await mcpServer.start()
    const status = mcpServer.getStatus()
    console.log(`[daemon] MCP server listening on port ${status.port}`)
  } catch (err) {
    console.warn('[daemon] MCP server failed to start:', err)
    mcpServer = null
  }

  // ── Start HTTP+WS server ────────────────────────────────────────────────

  const shutdown = (): void => {
    console.log('[daemon] Shutting down...')
    workspaceStore.setAgents(agentManager.exportWorkspaceAgents())
    agentManager.killAll()
    taskCoordinator.shutdown()
    headlessOrchestrator.shutdown()
    mcpServer?.stop()
    server.stop()
    removeLockFile(lockPath)
    // Give processes time to clean up
    setTimeout(() => process.exit(0), 2000)
  }

  const skillScanner = new SkillScanner()

  const server = new DaemonServer({
    socketPath,
    agentManager,
    configStore,
    sessionCatalog,
    codexSessionCatalog,
    headlessOrchestrator,
    taskCoordinator,
    workspaceStore,
    notificationService,
    mcpServer,
    skillScanner,
    authToken,
    onShutdown: shutdown
  })

  await server.start()

  // Write lock file
  writeLockFile(lockPath, {
    pid: process.pid,
    socketPath,
    startedAt: new Date().toISOString(),
    authToken
  })

  console.log(`[daemon] Ready — lock file written to ${lockPath}`)

  // ── Signal handling ─────────────────────────────────────────────────────

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  process.on('uncaughtException', (err) => {
    console.error('[daemon] Uncaught exception:', err)
    shutdown()
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[daemon] Unhandled rejection:', reason)
  })
}

main().catch((err) => {
  console.error('[daemon] Fatal error during startup:', err)
  process.exit(1)
})
