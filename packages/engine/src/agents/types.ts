import type { AgentRole, ProviderId, ProviderStatus } from '@hydra/protocol'

export type AccessLevel = 'read' | 'write'

export interface AgentRunRequest {
  /** Absolute working directory (always a task worktree for write access). */
  cwd: string
  prompt: string
  role: AgentRole
  access: AccessLevel
  /** JSON Schema the final answer must satisfy, enforced by the provider when supported. */
  outputSchema?: Record<string, unknown>
  /** Stream the reply token by token (plain-text answers only). */
  stream?: boolean
  model?: string | null
  /** Hard spend ceiling for this run, passed to providers that support one. */
  maxBudgetUsd?: number
  timeoutMs: number
}

export type AgentEvent =
  | { type: 'started'; pid: number | null; command: string }
  | { type: 'text'; text: string }
  /** A streamed piece of the reply (no line break implied). */
  | { type: 'text_delta'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number | null; model: string | null }
  | { type: 'structured'; value: unknown }
  | { type: 'final_text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'finished'; status: 'succeeded' | 'failed' | 'canceled' | 'timed_out'; detail: string | null }

export interface AdapterCapabilities {
  structuredOutput: boolean
  osSandbox: boolean
  fileToolConfinement: boolean
  reportsUsage: boolean
  reportsCost: boolean
}

export interface AgentAdapter {
  readonly id: ProviderId
  readonly displayName: string
  readonly capabilities: AdapterCapabilities
  probe(): Promise<ProviderStatus>
  run(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>
  /** Optionally start an answering process ahead of time for this directory. */
  prewarm?(cwd: string): void
  /** Stops any processes the adapter keeps for later use. */
  dispose?(): Promise<void>
}
