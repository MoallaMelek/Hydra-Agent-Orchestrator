import type { ChildProcess } from 'node:child_process'
import type { ProviderStatus } from '@hydra/protocol'
import { agentEnv } from '../process/env.js'
import { killTree, spawnArgv } from '../process/spawn.js'
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

export function claudeArgs(request: AgentRunRequest, options: { stdinMessages?: boolean } = {}): string[] {
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
  // Token-by-token text for replies the user is watching.
  if (request.stream && !request.outputSchema) args.push('--include-partial-messages')
  // A pre-started process reads its prompt as a JSON message once the user asks.
  if (options.stdinMessages) args.push('--input-format', 'stream-json')
  return args
}

/** The stdin payload for a process started with --input-format stream-json. */
export function stdinMessage(prompt: string): string {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } })}\n`
}

/** Stateful translator from Claude Code stream-json to normalized events. */
export function claudeTranslator() {
  let sawResult = false
  let streamed = false
  let resultError: string | null = null
  const translate = (event: Json): AgentEvent[] => {
    const out: AgentEvent[] = []
    if (event.type === 'stream_event') {
      const inner = asRecord(event.event)
      const delta = asRecord(inner.delta)
      if (inner.type === 'content_block_delta' && delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
        streamed = true
        out.push({ type: 'text_delta', text: delta.text })
      }
    } else if (event.type === 'assistant') {
      const content = asRecord(event.message).content
      for (const block of Array.isArray(content) ? content : []) {
        const b = asRecord(block)
        // When the reply was streamed, the full message repeats it: skip the text, keep tool calls.
        if (b.type === 'text' && !streamed && typeof b.text === 'string' && b.text.trim()) out.push({ type: 'text', text: b.text })
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
    const warm = this.takeWarm(request)
    yield* runJsonlProcess({
      executable, args: warm ? warm.args : claudeArgs(request), cwd: request.cwd, env: agentEnv('claude', this.env),
      stdin: warm ? stdinMessage(request.prompt) : request.prompt, timeoutMs: request.timeoutMs, translate, conclude,
      prestarted: warm?.child
    }, signal)
    // Keep the next question in this directory fast too.
    if (warmable(request)) this.prewarm(request.cwd)
  }

  // ── pre-started answering processes ─────────────────────────
  // Starting the CLI takes seconds; a process started ahead of time waits for its prompt on
  // stdin. It runs with exactly the same restricted, read-only arguments as a normal answer.
  private readonly warm = new Map<string, Warm>()

  prewarm(cwd: string): void {
    const existing = this.warm.get(cwd)
    if (existing && existing.child.exitCode === null && existing.child.signalCode === null) { existing.touch(); return }
    const executable = resolveProviderExecutable('claude', this.env)
    if (!executable) return
    // Bounded: evict the least recently used process beyond the limit.
    while (this.warm.size >= MAX_WARM) {
      const [oldestKey, oldest] = [...this.warm.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0]!
      this.warm.delete(oldestKey)
      oldest.dispose()
    }
    const args = claudeArgs(warmRequest(cwd), { stdinMessages: true })
    let child: ChildProcess
    try { child = spawnArgv(executable, args, { cwd, env: agentEnv('claude', this.env), stdin: 'pipe' }) } catch { return }
    child.on('error', () => { /* reported when used */ })
    const entry = new Warm(child, args, () => { if (this.warm.get(cwd) === entry) this.warm.delete(cwd) })
    this.warm.set(cwd, entry)
  }

  private takeWarm(request: AgentRunRequest): Warm | null {
    if (!warmable(request)) return null
    const entry = this.warm.get(request.cwd)
    if (!entry) return null
    this.warm.delete(request.cwd)
    entry.release()
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) return null
    return entry
  }

  async dispose(): Promise<void> {
    const all = [...this.warm.values()]
    this.warm.clear()
    await Promise.all(all.map((w) => w.dispose()))
  }
}

const MAX_WARM = 2
const WARM_IDLE_MS = 5 * 60_000
/** The spend cap a pre-started process is created with; requests allowing less never use one. */
const WARM_BUDGET_USD = 2

function warmRequest(cwd: string): AgentRunRequest {
  return { cwd, prompt: '', role: 'planner', access: 'read', stream: true, maxBudgetUsd: WARM_BUDGET_USD, timeoutMs: 0 }
}

/** Only plain-text, read-only answers with at least the warm budget can use a pre-started process. */
function warmable(request: AgentRunRequest): boolean {
  return request.access === 'read' && request.stream === true && !request.outputSchema && !request.model && (request.maxBudgetUsd ?? 0) >= WARM_BUDGET_USD
}

class Warm {
  usedAt = Date.now()
  private timer: ReturnType<typeof setTimeout>
  constructor(readonly child: ChildProcess, readonly args: string[], private readonly onExpire: () => void) {
    this.timer = setTimeout(() => { onExpire(); void this.dispose() }, WARM_IDLE_MS)
    this.timer.unref?.()
    child.once('close', () => { clearTimeout(this.timer); onExpire() })
  }
  touch(): void { this.usedAt = Date.now() }
  /** Hands the process over to a run: it is no longer idle and must not expire. */
  release(): void { clearTimeout(this.timer) }
  async dispose(): Promise<void> {
    clearTimeout(this.timer)
    await killTree(this.child)
  }
}
