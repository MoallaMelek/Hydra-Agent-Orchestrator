import type { z } from 'zod'
import { emptyUsage, type AgentRole, type AgentRunInfo, type ProviderId, type RunActivity, type TaskStage } from '@hydra/protocol'
import type { AccessLevel } from '../agents/types.js'
import { addUsage, assertCanStartRun, assertWithinBudget, remainingActiveMs, remainingUsd } from '../workflow/budget.js'
import { redact, redactValue } from '../util/redact.js'
import { policyFor } from '../workflow/policy.js'
import { CanceledError, providerFailure, ProviderUnavailableError, TransientProviderError, type BudgetExceededError } from '../util/errors.js'
import { isoNow, newId } from '../util/ids.js'
import { type EngineContext, logTask, updateTask } from './context.js'

export interface AgentCall<T> {
  taskId: string
  stage: TaskStage
  role: AgentRole
  provider: ProviderId
  access: AccessLevel
  cwd: string
  prompt: string
  jsonSchema?: Record<string, unknown>
  /** zod schema the structured output must satisfy (structured calls only). */
  parse?: z.ZodType<T>
  /** Stream the reply token by token (plain-text calls only). */
  stream?: boolean
  signal: AbortSignal
}

export interface AgentCallResult<T> {
  value: T
  run: AgentRunInfo
}

const OUTPUT_FLUSH_MS = 400
/** Tool calls kept on a run record (newest last). */
const MAX_ACTIVITY = 200
const MAX_REPLY_CHARS = 1_000_000

/** How a provider tool call touches the project: inspected, modified, or a program run. */
export function toolKind(name: string): RunActivity['kind'] {
  if (/^(Read|NotebookRead)$/.test(name)) return 'read'
  if (/^(Glob|Grep|LS)$/.test(name)) return 'search'
  if (/^(Edit|Write|MultiEdit|NotebookEdit|edit)$/.test(name)) return 'edit'
  if (/^(Bash|shell)$/.test(name)) return 'command'
  return 'other'
}

/** Streamed replies are flushed faster so the user sees them appear. */
const ANSWER_FLUSH_MS = 80
const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]*-----/g
const PEM_END = /-----END [A-Z0-9 ]*-----/

/**
 * How much of a streamed reply is safe to show now. Secrets must be redacted whole, so
 * the unfinished last word is held back, and so is everything from an unclosed
 * "-----BEGIN …-----" block (private keys arrive over many lines).
 */
export function streamableLength(text: string): number {
  let end = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\n'), text.lastIndexOf('\t')) + 1
  for (const match of text.matchAll(PEM_BEGIN)) {
    if (!PEM_END.test(text.slice(match.index + match[0].length))) { end = Math.min(end, match.index); break }
  }
  return end
}

/** A plain-text reply, streamed to the UI while it is written. Redacted before it is shown or stored. */
export async function callAgentText(ctx: EngineContext, call: AgentCall<string>): Promise<{ text: string; run: AgentRunInfo }> {
  const result = await runWithRetry(ctx, { ...call, jsonSchema: undefined, parse: undefined }, call.prompt)
  const text = redact(result.text).trim()
  if (!text) throw new Error(`${call.provider} returned an empty reply`)
  return { text, run: result.run }
}

/**
 * Runs one agent with budget enforcement, durable run records and live output.
 * If the structured answer is invalid it retries once with the validation error.
 */
export async function callAgent<T>(ctx: EngineContext, call: AgentCall<T> & { jsonSchema: Record<string, unknown>; parse: z.ZodType<T> }): Promise<AgentCallResult<T>> {
  const first = await runWithRetry(ctx, call, call.prompt)
  const parsed = call.parse.safeParse(first.structured)
  if (parsed.success) return { value: parsed.data, run: first.run }
  const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
  const retryPrompt = `${call.prompt}\n\nYour previous structured output was rejected by validation (${issues}). Return the structured output again, exactly matching the schema.`
  const second = await runWithRetry(ctx, call, retryPrompt)
  const reparsed = call.parse.safeParse(second.structured)
  if (reparsed.success) return { value: reparsed.data, run: second.run }
  throw new Error(`${call.provider} did not return valid structured output after a retry`)
}

/** How a customer signs a CLI back in (shown when its sign-in has expired). */
const SIGN_IN_COMMAND: Partial<Record<string, string>> = { claude: 'claude', codex: 'codex login' }
const RETRY_DELAY_MS = 3000

/**
 * Runs once; a network failure is retried exactly once after a short wait. A second
 * network failure pauses the task (resumable) instead of looping.
 */
async function runWithRetry<T>(ctx: EngineContext, call: AgentCall<T>, prompt: string): Promise<{ structured: unknown; text: string; run: AgentRunInfo }> {
  try {
    return await runOnce(ctx, call, prompt)
  } catch (error) {
    if (!(error instanceof TransientProviderError)) throw error
    logTask(ctx, call.taskId, 'warn', `${error.message}. Trying once more in a few seconds.`)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, RETRY_DELAY_MS)
      call.signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    if (call.signal.aborted) throw new CanceledError()
    try {
      return await runOnce(ctx, call, prompt)
    } catch (again) {
      if (again instanceof TransientProviderError) throw new ProviderUnavailableError(`${again.message}. Hydra tried twice; check your internet connection, then press Resume.`)
      throw again
    }
  }
}

async function runOnce<T>(ctx: EngineContext, call: AgentCall<T>, prompt: string): Promise<{ structured: unknown; text: string; run: AgentRunInfo }> {
  if (call.signal.aborted) throw new CanceledError()
  assertCanStartRun(ctx.store.getTask(call.taskId)!)
  const adapter = ctx.registry.get(call.provider)
  const release = await ctx.agentSlots.acquire(call.signal)
  // Re-check after waiting for a slot: other runs of this task may have spent the budget meanwhile.
  const task = ctx.store.getTask(call.taskId)!
  try { assertCanStartRun(task) } catch (error) { release(); throw error }

  const runAbort = new AbortController()
  const forward = () => runAbort.abort()
  call.signal.addEventListener('abort', forward, { once: true })

  let run: AgentRunInfo = {
    id: newId(), taskId: call.taskId, stage: call.stage, role: call.role, provider: call.provider, model: null,
    status: 'running', startedAt: isoNow(), endedAt: null, usage: emptyUsage(), error: null, pid: null, tail: '', activity: []
  }
  ctx.store.putRun(run)
  updateTask(ctx, call.taskId, (t) => { t.usage.agentRuns += 1 })

  let structured: unknown
  let finalText = ''
  let draft = ''
  let shown = ''
  let streamingStopped = false
  let outputError: string | null = null
  const bounded = (text: string, existing = 0): boolean => {
    if (existing + text.length <= MAX_REPLY_CHARS) return true
    outputError = 'Provider output exceeded the 1,000,000-character reply limit. The run was stopped; no complete result is claimed.'
    runAbort.abort(); return false
  }
  let answerTimer: ReturnType<typeof setTimeout> | null = null
  const flushAnswer = (final: boolean) => {
    answerTimer = null
    if (streamingStopped) return
    const ready = redact(final ? draft : draft.slice(0, streamableLength(draft)))
    // Never contradict what was already shown: if redaction would change it, stop streaming.
    // The final answer is still stored, redacted as a whole.
    if (!ready.startsWith(shown)) { streamingStopped = true; return }
    if (ready.length === shown.length) return
    const piece = ready.slice(shown.length)
    shown = ready
    run = { ...run, tail: (run.tail + piece).slice(-8000) }
    ctx.store.publish({ type: 'run.output', runId: run.id, taskId: call.taskId, text: piece.slice(-16_000), stream: 'answer' })
  }
  const emitDelta = (text: string) => {
    if (!bounded(text, draft.length)) return
    draft += text
    if (!answerTimer) answerTimer = setTimeout(() => flushAnswer(false), ANSWER_FLUSH_MS)
  }
  let budgetError: BudgetExceededError | null = null
  let pending = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    flushTimer = null
    if (!pending) return
    ctx.store.publish({ type: 'run.output', runId: run.id, taskId: call.taskId, text: pending.slice(-16_000) })
    pending = ''
  }
  const emitText = (raw: string) => {
    const text = redact(raw)
    run = { ...run, tail: (run.tail + text + '\n').slice(-8000) }
    pending = (pending + `${text}\n`).slice(-16_000)
    if (!flushTimer) flushTimer = setTimeout(flush, OUTPUT_FLUSH_MS)
  }

  const policy = policyFor(task.mode)
  // A single run may never outlive the task's remaining active-time budget.
  const timeoutMs = Math.max(1000, Math.min(policy.agentTimeoutMinutes * 60_000, remainingActiveMs(task)))
  let finished: { status: 'succeeded' | 'failed' | 'canceled' | 'timed_out'; detail: string | null } = { status: 'failed', detail: 'Agent ended without a result' }
  try {
    for await (const event of adapter.run({
      cwd: call.cwd, prompt, role: call.role, access: call.access, outputSchema: call.jsonSchema, stream: call.stream,
      model: null, maxBudgetUsd: remainingUsd(task), timeoutMs
    }, runAbort.signal)) {
      switch (event.type) {
        case 'started':
          if (event.pid) { run = { ...run, pid: event.pid }; ctx.store.putRun(run) }
          break
        case 'text': emitText(event.text); break
        case 'text_delta': emitDelta(event.text); break
        case 'final_text': if (bounded(event.text)) finalText = event.text; break
        case 'tool': {
          // Redact the whole target first, then shorten it (shortening first could cut a secret's marker off).
          const target = redact(event.summary).slice(0, 300)
          emitText(`› ${event.name} ${target}`)
          // Structured copy for the operations view: tool name and redacted target only.
          const activity: RunActivity = { at: isoNow(), tool: redact(event.name).slice(0, 60), target, kind: toolKind(event.name) }
          run = { ...run, activity: [...run.activity, activity].slice(-MAX_ACTIVITY) }
          ctx.store.publish({ type: 'run.activity', runId: run.id, taskId: call.taskId, activity })
          break
        }
        case 'error': emitText(`⚠ ${event.message}`); break
        case 'structured': if (bounded(JSON.stringify(event.value) ?? '')) structured = redactValue(event.value); break
        case 'usage': {
          run = { ...run, model: event.model ?? run.model, usage: addUsage(run.usage, event) }
          const updated = updateTask(ctx, call.taskId, (t) => { t.usage = { ...addUsage(t.usage, event), agentRuns: t.usage.agentRuns } })
          try { assertWithinBudget(updated, updated.usage) } catch (error) {
            budgetError = error as BudgetExceededError
            runAbort.abort()
          }
          break
        }
        case 'finished': finished = { status: event.status, detail: event.detail ? redact(event.detail).slice(0, 4000) : null }; break
        default: break
      }
    }
  } catch (error) {
    finished = { status: 'failed', detail: redact(error instanceof Error ? error.message : String(error)).slice(0, 4000) }
  } finally {
    if (flushTimer) clearTimeout(flushTimer)
    flush()
    if (answerTimer) clearTimeout(answerTimer)
    flushAnswer(true)
    call.signal.removeEventListener('abort', forward)
    release()
  }

  if (outputError) finished = { status: 'failed', detail: outputError }
  const status: AgentRunInfo['status'] = finished.status === 'succeeded' ? 'succeeded' : finished.status === 'canceled' ? 'canceled' : 'failed'
  run = { ...run, status, endedAt: isoNow(), error: budgetError?.message ?? (status === 'succeeded' ? null : finished.detail) }
  ctx.store.putRun(run)

  if (budgetError) throw budgetError
  if (call.signal.aborted || finished.status === 'canceled') throw new CanceledError()
  if (finished.status === 'failed') {
    const detail = (finished.detail ?? '').slice(0, 400)
    const name = adapter.displayName
    switch (providerFailure(detail)) {
      case 'limit': throw new ProviderUnavailableError(`${name} is not accepting work right now (usage or rate limit): ${detail}`)
      case 'sign_in': throw new ProviderUnavailableError(`${name} needs you to sign in again: run \`${SIGN_IN_COMMAND[call.provider] ?? 'its login command'}\` in a terminal, then press Resume.`)
      case 'missing': throw new ProviderUnavailableError(`${name} could not be started. Check that it is installed (Agents & providers), then press Resume.`)
      case 'network': throw new TransientProviderError(`${name} could not reach its service: ${detail}`)
      default: break
    }
  }
  if (finished.status !== 'succeeded') throw new Error(`${adapter.displayName} ${finished.status === 'timed_out' ? 'timed out' : 'failed'}: ${finished.detail ?? 'no detail'}`)
  return { structured, text: finalText || draft, run }
}
