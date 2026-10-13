import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import type { ProviderStatus } from '@hydra/protocol'
import type { AgentAdapter, AgentEvent, AgentRunRequest } from './types.js'

export interface ScriptedStep {
  /** Files to write (relative to cwd). Only honoured for write access. */
  files?: Record<string, string>
  structured?: unknown
  text?: string
  usage?: { inputTokens: number; outputTokens: number; costUsd: number | null }
  fail?: string
  /** Simulated work time; aborts are honoured while waiting. */
  delayMs?: number
}

export type ScriptHandler = (request: AgentRunRequest, call: number) => ScriptedStep | Promise<ScriptedStep>

/**
 * Deterministic adapter for automated tests. It is never registered by the
 * production engine factory (see registry.ts).
 */
export class ScriptedAdapter implements AgentAdapter {
  readonly id = 'scripted' as const
  readonly displayName = 'Scripted (test only)'
  readonly capabilities = { structuredOutput: true, osSandbox: false, fileToolConfinement: true, reportsUsage: true, reportsCost: true }
  readonly calls: AgentRunRequest[] = []

  constructor(private readonly handler: ScriptHandler) {}

  async probe(): Promise<ProviderStatus> {
    return { id: this.id, displayName: this.displayName, installed: true, path: null, version: 'test', authenticated: true, authMethod: 'test', capabilities: this.capabilities, problems: [] }
  }

  async *run(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    this.calls.push(request)
    yield { type: 'started', pid: null, command: 'scripted' }
    const step = await this.handler(request, this.calls.length)
    if (step.delayMs) {
      const canceled = await new Promise<boolean>((done) => {
        if (signal.aborted) return done(true)
        const timer = setTimeout(() => done(false), step.delayMs)
        signal.addEventListener('abort', () => { clearTimeout(timer); done(true) }, { once: true })
      })
      if (canceled) {
        yield { type: 'finished', status: 'canceled', detail: 'Canceled' }
        return
      }
    }
    if (step.files && request.access === 'write') {
      for (const [path, content] of Object.entries(step.files)) {
        const target = resolve(request.cwd, path)
        const rel = relative(request.cwd, target)
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`scripted write escapes cwd: ${path}`)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(join(request.cwd, path), content)
      }
    }
    if (step.text) yield { type: 'text', text: step.text }
    if (step.usage) yield { type: 'usage', inputTokens: step.usage.inputTokens, outputTokens: step.usage.outputTokens, cachedTokens: 0, costUsd: step.usage.costUsd, model: 'scripted' }
    if (step.structured !== undefined) yield { type: 'structured', value: step.structured }
    if (step.fail) {
      yield { type: 'finished', status: 'failed', detail: step.fail }
      return
    }
    yield { type: 'finished', status: 'succeeded', detail: null }
  }
}
