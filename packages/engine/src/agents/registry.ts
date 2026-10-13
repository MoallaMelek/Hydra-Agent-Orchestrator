import type { ProviderId, ProviderStatus } from '@hydra/protocol'
import { ClaudeAdapter } from './claude.js'
import { CodexAdapter } from './codex.js'
import type { AgentAdapter } from './types.js'

export class AdapterRegistry {
  private readonly adapters = new Map<ProviderId, AgentAdapter>()
  private statuses = new Map<ProviderId, ProviderStatus>()

  constructor(adapters: AgentAdapter[]) {
    for (const adapter of adapters) this.adapters.set(adapter.id, adapter)
  }

  /** The production set. The scripted adapter is deliberately absent. */
  static production(env: NodeJS.ProcessEnv = process.env): AdapterRegistry {
    return new AdapterRegistry([new ClaudeAdapter(env), new CodexAdapter(env)])
  }

  get(id: ProviderId): AgentAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error(`Provider ${id} is not available in this build`)
    return adapter
  }

  has(id: ProviderId): boolean {
    return this.adapters.has(id)
  }

  ids(): ProviderId[] {
    return [...this.adapters.keys()]
  }

  async refresh(): Promise<ProviderStatus[]> {
    const results = await Promise.all([...this.adapters.values()].map((adapter) => adapter.probe().catch((error: unknown): ProviderStatus => ({
      id: adapter.id, displayName: adapter.displayName, installed: false, path: null, version: null, authenticated: null, authMethod: null,
      capabilities: adapter.capabilities, problems: [`Probe failed: ${(error as Error).message}`]
    }))))
    this.statuses = new Map(results.map((status) => [status.id, status]))
    return results
  }

  status(): ProviderStatus[] {
    return [...this.statuses.values()]
  }

  /** Usable means installed with no blocking problems (as of the last refresh). */
  usable(id: ProviderId): boolean {
    const status = this.statuses.get(id)
    return Boolean(status?.installed && status.problems.length === 0)
  }
}
