import type { ProviderStatus } from '@hydra/protocol'
import { agentEnv } from '../process/env.js'
import { runJsonlProcess } from './jsonl-process.js'
import { captureOutput, resolveProviderExecutable } from './resolve.js'
import { parseClaudeAuthStatus, SIGN_IN_HELP } from './auth.js'
import type { AgentAdapter, AgentEvent, AgentRunRequest } from './types.js'

const READ_TOOLS = 'Read,Glob,Grep'
const WRITE_TOOLS = 'Read,Glob,Grep,Edit,Write'
const REQUIRED_FLAGS = ['--restricted', '--json-schema', '--permission-prompts', '--tools', '--output-format']

type Json = Record<string, unknown>
const asRecord = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {})
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export function claudeArgs(request: AgentRunRequest): string[] {
  const write = request.access === 'write'
  const args = [
    '-p', '--output-format', 'stream-json', '--verbose',
    // Removes command-running tools and confines file tools to the working directory.
    '--restricted', '--safe-mode', '--strict-mcp-config',
    // Nothing may prompt: anything that would need approval is denied.
    '--permission-prompts', 'none',
    '--no-session-persistence',
    '--tools', write ? WRITE_TOOLS : READ_TOOLS,
    '--permission-mode', write ? 'acceptEdits' : 'dontAsk'
  ]
  if (request.model) args.push('--model', request.model)
  if (request.outputSchema) args.push('--json-schema', JSON.stringify(request.outputSchema))
  if (request.maxBudgetUsd && request.maxBudgetUsd > 0) args.push('--max-budget-usd', request.maxBudgetUsd.toFixed(2))
  return args
}

/** Stateful translator from Claude Code stream-json to normalized events. */
export function claudeTranslator() {
  let sawResult = false
  let resultError: string | null = null
  const translate = (event: Json): AgentEvent[] => {
    const out: AgentEvent[] = []
    if (event.type === 'assistant') {
      const content = asRecord(event.message).content
      for (const block of Array.isArray(content) ? content : []) {
        const b = asRecord(block)
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ type: 'text', text: b.text })
        if (b.type === 'tool_use') {
          const input = asRecord(b.input)
          const target = String(input.file_path ?? input.path ?? input.pattern ?? '')
          out.push({ type: 'tool', name: String(b.name ?? 'tool'), summary: target.slice(0, 300) })
        }
      }
    } else if (event.type === 'result') {
      sawResult = true
      const usage = asRecord(event.usage)
      const modelUsage = asRecord(event.modelUsage)
      out.push({
        type: 'usage',
        inputTokens: num(usage.input_tokens) + num(usage.cache_creation_input_tokens),
        outputTokens: num(usage.output_tokens),
        cachedTokens: num(usage.cache_read_input_tokens),
        costUsd: typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null,
        model: Object.keys(modelUsage)[0] ?? null
      })
      if (event.structured_output !== undefined && event.structured_output !== null) out.push({ type: 'structured', value: event.structured_output })
      if (typeof event.result === 'string') out.push({ type: 'final_text', text: event.result })
      if (event.is_error === true || (typeof event.subtype === 'string' && event.subtype !== 'success')) {
        resultError = `Claude reported ${String(event.subtype ?? 'an error')}${typeof event.result === 'string' ? `: ${event.result.slice(0, 500)}` : ''}`
        out.push({ type: 'error', message: resultError })
      }
      const denials = event.permission_denials
      if (Array.isArray(denials) && denials.length) {
        out.push({ type: 'tool', name: 'permission_denied', summary: `${denials.length} tool call(s) denied by policy` })
      }
    }
    return out
  }
  const conclude = (exitCode: number | null, stderrTail: string) => {
    if (exitCode === 0 && sawResult && !resultError) return { status: 'succeeded' as const, detail: null }
    return { status: 'failed' as const, detail: resultError ?? (stderrTail.trim().slice(-800) || `claude exited with code ${exitCode}`) }
  }
  return { translate, conclude }
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const
  readonly displayName = 'Claude Code'
  readonly capabilities = { structuredOutput: true, osSandbox: false, fileToolConfinement: true, reportsUsage: true, reportsCost: true }

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async probe(): Promise<ProviderStatus> {
    const path = resolveProviderExecutable('claude', this.env)
    const base: ProviderStatus = { id: this.id, displayName: this.displayName, installed: false, path, version: null, authenticated: null, authMethod: null, capabilities: this.capabilities, problems: [] }
    if (!path) return { ...base, problems: ['Claude Code CLI not found. Install it and sign in with your own account, or set HYDRA_CLAUDE_PATH.'] }
    const [versionOut, help, authOut] = await Promise.all([
      captureOutput(path, ['--version']),
      captureOutput(path, ['--help']),
      captureOutput(path, ['auth', 'status'])
    ])
    const auth = parseClaudeAuthStatus(authOut)
    const problems: string[] = []
    const missing = REQUIRED_FLAGS.filter((flag) => !help.includes(flag))
    if (missing.length) problems.push(`This Claude Code version lacks ${missing.join(', ')}; update Claude Code. Hydra will not run it without confinement flags.`)
    // An API key in the customer's own environment is a valid sign-in that `auth status` may not reflect.
    if (auth.authenticated === false && !this.env.ANTHROPIC_API_KEY) problems.push(SIGN_IN_HELP.claude)
    return { ...base, installed: true, version: versionOut.trim() || null, authenticated: auth.authenticated, authMethod: auth.method, problems }
  }

  async *run(request: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const executable = resolveProviderExecutable('claude', this.env)
    if (!executable) {
      yield { type: 'finished', status: 'failed', detail: 'Claude Code CLI not found' }
      return
    }
    const { translate, conclude } = claudeTranslator()
    yield* runJsonlProcess({
      executable, args: claudeArgs(request), cwd: request.cwd, env: agentEnv(this.env),
      stdin: request.prompt, timeoutMs: request.timeoutMs, translate, conclude
    }, signal)
  }
}
