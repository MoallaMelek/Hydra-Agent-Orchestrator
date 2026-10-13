import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderStatus } from '@hydra/protocol'
import { agentEnv } from '../process/env.js'
import { runJsonlProcess } from './jsonl-process.js'
import { captureOutput, resolveProviderExecutable } from './resolve.js'
import { parseCodexLoginStatus, SIGN_IN_HELP } from './auth.js'
import type { AgentAdapter, AgentEvent, AgentRunRequest } from './types.js'

type Json = Record<string, unknown>
const asRecord = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {})
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const REQUIRED_FLAGS = ['--json', '--sandbox', '--output-schema', '--ephemeral', '--cd']

export function codexArgs(request: AgentRunRequest, schemaPath: string | null): string[] {
  const args = [
    'exec', '--json', '--ephemeral',
    '--cd', request.cwd,
    '--sandbox', request.access === 'write' ? 'workspace-write' : 'read-only',
    // Never pause for approval; anything outside the sandbox is simply refused.
    '-c', 'approval_policy="never"',
    '-c', 'sandbox_workspace_write.network_access=false',
    // User-configured MCP servers run outside the sandbox; they are not available to task agents.
    '-c', 'mcp_servers={}'
  ]
  if (request.model) args.push('--model', request.model)
  if (schemaPath) args.push('--output-schema', schemaPath)
  args.push('-') // prompt on stdin
  return args
}

export function codexTranslator(expectStructured: boolean) {
  let turnCompleted = false
  let failure: string | null = null
  let lastMessage: string | null = null
  const translate = (event: Json): AgentEvent[] => {
    const out: AgentEvent[] = []
    const item = asRecord(event.item)
    if (event.type === 'item.completed') {
      if (item.type === 'agent_message' && typeof item.text === 'string') {
        lastMessage = item.text
        out.push({ type: 'text', text: item.text })
      } else if (item.type === 'command_execution') {
        out.push({ type: 'tool', name: 'shell', summary: `${String(item.command ?? '').slice(0, 240)} → exit ${String(item.exit_code ?? '?')}` })
      } else if (item.type === 'file_change') {
        const changes = Array.isArray(item.changes) ? item.changes.map((c) => String(asRecord(c).path ?? '')).join(', ') : ''
        out.push({ type: 'tool', name: 'edit', summary: changes.slice(0, 300) })
      } else if (item.type === 'error' && typeof item.message === 'string') {
        out.push({ type: 'text', text: `⚠ ${item.message}` })
      }
    } else if (event.type === 'turn.completed') {
      turnCompleted = true
      const usage = asRecord(event.usage)
      out.push({
        type: 'usage',
        inputTokens: Math.max(0, num(usage.input_tokens) - num(usage.cached_input_tokens)),
        outputTokens: num(usage.output_tokens) + num(usage.reasoning_output_tokens),
        cachedTokens: num(usage.cached_input_tokens),
        costUsd: null,
        model: null
      })
      if (lastMessage !== null) {
        out.push({ type: 'final_text', text: lastMessage })
        if (expectStructured) {
          try { out.push({ type: 'structured', value: JSON.parse(lastMessage) }) } catch { /* validated by the caller */ }
        }
      }
    } else if (event.type === 'turn.failed' || event.type === 'error') {
      failure = String(asRecord(event.error).message ?? event.message ?? 'Codex reported a failure')
      out.push({ type: 'error', message: failure })
    }
    return out
  }
  const conclude = (exitCode: number | null, stderrTail: string) => {
    if (exitCode === 0 && turnCompleted && !failure) return { status: 'succeeded' as const, detail: null }
    return { status: 'failed' as const, detail: failure ?? (stderrTail.trim().slice(-800) || `codex exited with code ${exitCode}`) }
  }
  return { translate, conclude }
}

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const
  readonly displayName = 'Codex CLI'
  readonly capabilities = { structuredOutput: true, osSandbox: true, fileToolConfinement: true, reportsUsage: true, reportsCost: false }

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async probe(): Promise<ProviderStatus> {
    const path = resolveProviderExecutable('codex', this.env)
    const base: ProviderStatus = { id: this.id, displayName: this.displayName, installed: false, path, version: null, authenticated: null, authMethod: null, capabilities: this.capabilities, problems: [] }
    if (!path) return { ...base, problems: ['Codex CLI not found. Install it and sign in with your own account, or set HYDRA_CODEX_PATH.'] }
    const [versionOut, help, authOut] = await Promise.all([
      captureOutput(path, ['--version']),
      captureOutput(path, ['exec', '--help']),
      captureOutput(path, ['login', 'status'], { includeStderr: true })
    ])
    const auth = parseCodexLoginStatus(authOut)
    const problems: string[] = []
    const missing = REQUIRED_FLAGS.filter((flag) => !help.includes(flag))
    if (missing.length) problems.push(`This Codex version lacks ${missing.join(', ')}; update Codex CLI.`)
    if (auth.authenticated === false) problems.push(SIGN_IN_HELP.codex)
    return { ...base, installed: true, version: versionOut.trim() || null, authenticated: auth.authenticated, authMethod: auth.method, problems }
  }

  async *run(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const executable = resolveProviderExecutable('codex', this.env)
    if (!executable) {
      yield { type: 'finished', status: 'failed', detail: 'Codex CLI not found' }
      return
    }
    let schemaDir: string | null = null
    let schemaPath: string | null = null
    if (request.outputSchema) {
      schemaDir = mkdtempSync(join(tmpdir(), 'hydra-schema-'))
      schemaPath = join(schemaDir, 'schema.json')
      writeFileSync(schemaPath, JSON.stringify(request.outputSchema), { mode: 0o600 })
    }
    try {
      const { translate, conclude } = codexTranslator(Boolean(request.outputSchema))
      yield* runJsonlProcess({
        executable, args: codexArgs(request, schemaPath), cwd: request.cwd, env: agentEnv(this.env),
        stdin: request.prompt, timeoutMs: request.timeoutMs, translate, conclude
      }, signal)
    } finally {
      if (schemaDir) rmSync(schemaDir, { recursive: true, force: true })
    }
  }
}
