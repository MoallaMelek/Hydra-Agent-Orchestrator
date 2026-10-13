import type { ProviderId } from '@shared/types'
import { getDefaultModelForProvider } from '@shared/types'
import type { TaskRole, PermissionMode } from '@shared/tasks'
import type { HeadlessOrchestrator } from '../headless/HeadlessOrchestrator'
import { cliHelp, resolveCliExecutable } from '../agents/cliExecution'
import type { SemanticResult } from './semanticResults'
import { ProviderModelCatalog } from '../agents/ProviderModelCatalog'
import { canonicalProjectRoot } from '../security/pathPolicy'

export interface AdapterRequest { root: string; prompt: string; role: TaskRole; mode: PermissionMode; signal: AbortSignal; onLog: (line: string) => void; onRun: (id: string) => void; onText?: (text: string) => void }
export interface AdapterResult { runId: string; result: SemanticResult }
export interface TaskProviderAdapter {
  id: ProviderId; label: string; canWrite: boolean; supportsSandbox: boolean; confinedFileWrites?: boolean
  available(): Promise<boolean>
  execute(request: AdapterRequest): Promise<AdapterResult>
}

export function createTaskAdapters(headless: HeadlessOrchestrator, configuredModel?: (id: ProviderId) => string | null, models: Pick<ProviderModelCatalog, 'list'> = new ProviderModelCatalog()): TaskProviderAdapter[] {
  return (['claude', 'codex'] as const).map(id => ({
    id, label: id === 'claude' ? 'Claude' : 'Codex', canWrite: true, supportsSandbox: id === 'codex', confinedFileWrites: id === 'claude',
    async available() {
      if (!resolveCliExecutable(id)) return false
      const help = cliHelp(id)
      return id === 'claude' ? help.includes('--tools') && help.includes('--restricted') && help.includes('--safe-mode') : help.includes('exec')
    },
    async execute(request) {
      const writing = ['implementation', 'repair', 'verification'].includes(request.role)
      if (writing && id === 'claude' && request.mode === 'autonomous') throw new Error('Claude restricted file tools are not an OS sandbox. Autonomous writing requires a sandbox-capable provider.')
      if (request.signal.aborted) throw new Error('Task canceled')
      const catalog = await models.list(id)
      if (request.signal.aborted) throw new Error('Task canceled during model discovery')
      const canonical = await canonicalProjectRoot(request.root)
      if (request.signal.aborted) throw new Error('Task canceled before provider start')
      if ((process.platform === 'win32' ? canonical.toLowerCase() !== request.root.toLowerCase() : canonical !== request.root)) throw new Error('Canonical project root changed before provider start')
      const model = configuredModel?.(id) || catalog.find(v => v.isDefault)?.id || getDefaultModelForProvider(id)
      return new Promise<AdapterResult>((resolve, reject) => {
        let runId = ''
        const clean = () => {
          headless.off('event', onEvent); headless.off('terminal', onTerminal); headless.off('text', onText)
          request.signal.removeEventListener('abort', abort)
        }
        const finish = (run: ReturnType<HeadlessOrchestrator['get']>) => {
          if (!run || run.id !== runId || run.status === 'running') return
          clean()
          if (run.status !== 'completed' || !run.result?.terminal || run.result.failed) reject(new Error(run.error || `Provider ${run.status}`))
          else if (run.result.permissionDenied) reject(new Error('Provider denied a requested permission; adjust the task scope locally'))
          else resolve({ runId, result: run.result })
        }
        const onEvent = (event: { runId: string; data: string }) => { if (event.runId === runId) request.onLog(event.data) }
        const onText = (event: { runId: string; text: string }) => { if (event.runId === runId) request.onText?.(event.text) }
        const onTerminal = (run: NonNullable<ReturnType<HeadlessOrchestrator['get']>>) => finish(run)
        const abort = () => { headless.cancel(runId) }
        headless.on('event', onEvent); headless.on('terminal', onTerminal); headless.on('text', onText)
        request.signal.addEventListener('abort', abort, { once: true })
        try {
          const run = headless.start({ projectDir: request.root, prompt: `Hydra has already assigned your role and will schedule independent peer review. Work only on this assigned step. Do not invoke Claude/Codex CLIs, spawn agents, delegate, or perform the next orchestration step yourself. Do not change collaboration protocol files unless the actual requested feature requires it. Report your observed results and return control to Hydra.\n\n${request.prompt}`, provider: id,
            model, sandbox: writing ? 'workspace-write' : 'read-only',
            accessMode: request.role === 'synthesis' ? 'context-only' : writing ? 'project-write' : 'read-only',
            timeoutMs: request.mode === 'autonomous' ? 20 * 60_000 : 10 * 60_000 })
          runId = run.id; request.onRun(runId); finish(run)
        } catch (error) { clean(); reject(error) }
      })
    }
  }))
}
