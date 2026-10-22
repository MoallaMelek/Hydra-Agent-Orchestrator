import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { CommandAck, EngineSnapshot, EventEnvelope, Project, ProviderStatus, Task, TaskDetail, TaskDiff } from '@hydra/protocol'
import '../design/tokens.css'
import '../design/base.css'
import '../design/components.css'
import '../views/app.css'
import { EngineStore } from '../api/store'
import type { ConnectionStatus, Transport } from '../api/transport'
import { AppProvider, useApp, type Route } from '../app/context'
import { Shell } from '../app/Shell'
import pack from '../../../../design/prototypes/data/missions.json'

/**
 * Recorded-fixture review harness. Serves missions recorded on the real Hydra engine
 * (Git worktrees, check processes, review records) with the scripted test adapter instead of
 * provider CLIs: tool calls and review text are scripted, not model activity. Read-only:
 * every command is refused. Never part of the shipped bundle (vite builds index.html only).
 */
interface Mission { scenario: string; detail: TaskDetail; diff: TaskDiff | null; reviews: Array<{ at: string; review: NonNullable<Task['review']>; reviewedSha: string | null }> }
const data = pack as unknown as { recordedAt: string; engineCommit: string; engineVersion: string; projects: Project[]; providers: ProviderStatus[]; missions: Mission[] }

class RecordedTransport implements Transport {
  readonly kind = 'local' as const
  async snapshot(): Promise<EngineSnapshot> {
    return { protocolVersion: 1, engineVersion: `${data.engineVersion} · recorded`, lastSeq: 0, projects: data.projects, tasks: data.missions.map((m) => m.detail.task), providers: data.providers, devices: [], activeRuns: [], agentSlots: 3, remote: { relayUrl: null, connected: false, addresses: [], enabled: false, until: null, host: null } } as unknown as EngineSnapshot
  }
  async taskDetail(taskId: string): Promise<TaskDetail> { return this.find(taskId).detail }
  async taskDiff(taskId: string): Promise<TaskDiff> { const d = this.find(taskId).diff; if (!d) throw new Error('No diff was recorded for this mission (its worktree was removed).'); return d }
  async evidenceLog(): Promise<string> { return 'Recorded fixture: the full log file was not captured in this pack. The output tail above is the recorded tail.' }
  async execute(command: Record<string, unknown>): Promise<CommandAck> {
    if (command.type === 'agents.recommend') return { ok: true, result: { strategy: 'rule', basis: 'rule', reason: 'Recorded fixture: no history.', evidence: [], assignment: { planner: 'claude', implementer: 'codex', reviewer: 'claude' } } } as CommandAck
    if (command.type === 'outcomes.get') return { ok: true, result: { count: 0, byCategory: {} } } as CommandAck
    return { ok: false, error: { code: 'unavailable', message: 'Recorded fixture: read-only. Commands are not sent anywhere.' } } as CommandAck
  }
  /** Replays the distinct reviews the journal held, then the final task, as task.updated events. */
  stream(_after: number, onEvent: (e: EventEnvelope) => void, onStatus: (s: ConnectionStatus) => void): () => void {
    onStatus('live')
    let seq = 1
    for (const m of data.missions) {
      if (m.reviews.length < 2) continue
      for (const r of m.reviews) onEvent({ seq: seq++, at: r.at, event: { type: 'task.updated', task: { ...m.detail.task, review: r.review, reviewedSha: r.reviewedSha } } } as EventEnvelope)
      onEvent({ seq: seq++, at: m.detail.task.updatedAt, event: { type: 'task.updated', task: m.detail.task } } as EventEnvelope)
    }
    return () => {}
  }
  private find(id: string): Mission { const m = data.missions.find((x) => x.detail.task.id === id); if (!m) throw new Error('Unknown mission'); return m }
}

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'light') document.documentElement.dataset.theme = 'light'
const store = new EngineStore(new RecordedTransport())

function Boot() {
  const { go } = useApp()
  useEffect(() => {
    const scenario = params.get('mission')
    const view = params.get('view')
    const m = data.missions.find((x) => x.scenario === scenario)
    const route: Route | null = m ? { view: 'task', taskId: m.detail.task.id } : view === 'providers' || view === 'settings' || view === 'devices' ? { view } : view === 'project' ? { view: 'project', projectId: data.projects[0]!.id } : null
    if (route) go(route)
    ;(window as unknown as { hydraReview: unknown }).hydraReview = { go, missions: data.missions.map((x) => ({ scenario: x.scenario, id: x.detail.task.id })) }
  }, [go])
  return null
}

async function start() {
  await store.start()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider store={store} host={{}}>
        <div className="lab-banner" role="note">RECORDED FIXTURE · engine {data.engineCommit.slice(0, 7)} · scripted agents, not model activity · read-only</div>
        <Shell />
        <Boot />
      </AppProvider>
    </StrictMode>
  )
}
void start()
