import type { CommandAck, EngineSnapshot, EventEnvelope, TaskDetail, TaskDiff } from '@hydra/protocol'
import type { ConnectionStatus, Transport } from '../api/transport'
import { FIXTURE_PROVIDERS, type FixtureWorld } from './world'

/** SIMULATED FIXTURE: serves a FixtureWorld through the same interface as the real engine. */
export class FixtureTransport implements Transport {
  readonly kind = 'local' as const
  /** Scenario hooks for commands (e.g. continue after a plan approval). */
  onCommand: (command: Record<string, unknown>) => void = () => {}

  constructor(private readonly world: FixtureWorld, private readonly slots = 3) {}

  async snapshot(): Promise<EngineSnapshot> {
    return {
      protocolVersion: 1, engineVersion: '2.0.0-fixture', lastSeq: this.world.seq,
      projects: [...this.world.projects], tasks: [...this.world.tasks.values()], providers: FIXTURE_PROVIDERS, devices: [],
      activeRuns: [...this.world.runs.values()].filter((r) => r.status === 'running'), agentSlots: this.slots,
      remote: { relayUrl: null, connected: false, addresses: [], enabled: false, until: null, host: null }
    }
  }

  async taskDetail(taskId: string): Promise<TaskDetail> {
    return { task: this.world.tasks.get(taskId)!, runs: [...this.world.runs.values()].filter((r) => r.taskId === taskId), evidence: this.world.evidence.filter((e) => e.taskId === taskId) }
  }

  async taskDiff(taskId: string): Promise<TaskDiff> {
    const task = this.world.tasks.get(taskId)!
    const patch = 'diff --git a/src/cart.js b/src/cart.js\nindex 1..2 100644\n--- a/src/cart.js\n+++ b/src/cart.js\n@@ -1,3 +1,3 @@\n export function total(items) {\n-  return items.reduce((s, i) => s + i.price, 0)\n+  return items.reduce((s, i) => s + i.price * i.qty, 0)\n }'
    return { baseSha: task.workspace?.baseSha ?? '', headSha: task.workspace?.headSha ?? '', truncated: false, files: [{ path: 'src/cart.js', oldPath: null, status: 'modified', additions: 1, deletions: 1, patch }] } as TaskDiff
  }

  async evidenceLog(): Promise<string> { return 'SIMULATED FIXTURE LOG — not real command output.' }

  async execute(command: Record<string, unknown>): Promise<CommandAck> {
    this.onCommand(command)
    if (command.type === 'agents.recommend') return { ok: true, result: { strategy: 'claude→codex→claude', basis: 'rule', reason: 'Simulated fixture: rule-based suggestion.', evidence: [], assignment: { planner: 'claude', implementer: 'codex', reviewer: 'claude' } } } as CommandAck
    if (command.type === 'outcomes.get') return { ok: true, result: { count: 0, byCategory: {} } } as CommandAck
    return { ok: true, result: null } as CommandAck
  }

  stream(_after: number, onEvent: (envelope: EventEnvelope) => void, onStatus: (status: ConnectionStatus) => void): () => void {
    onStatus('live')
    return this.world.on(onEvent)
  }
}
