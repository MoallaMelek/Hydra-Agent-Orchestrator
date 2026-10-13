import type { z } from 'zod'
import { emptyUsage, type AgentRole, type AgentRunInfo, type ProviderId, type TaskStage } from '@hydra/protocol'
import type { AccessLevel } from '../agents/types.js'
import { addUsage, assertCanStartRun, assertWithinBudget, remainingActiveMs, remainingUsd } from '../workflow/budget.js'
import { redact } from '../util/redact.js'
import { policyFor } from '../workflow/policy.js'
import { CanceledError, isProviderLimit, ProviderUnavailableError, type BudgetExceededError } from '../util/errors.js'
import { isoNow, newId } from '../util/ids.js'
import { type EngineContext, updateTask } from './context.js'

export interface AgentCall<T> {
  taskId: string
  stage: TaskStage
  role: AgentRole
  provider: ProviderId
  access: AccessLevel
  cwd: string
  prompt: string
  jsonSchema: Record<string, unknown>
  /** zod schema the structured output must satisfy. */
  parse: z.ZodType<T>
  signal: AbortSignal
}

export interface AgentCallResult<T> {
  value: T
  run: AgentRunInfo
}

const OUTPUT_FLUSH_MS = 400

/**
 * Runs one agent with budget enforcement, durable run records and live output.
 * If the structured answer is invalid it retries once with the validation error.
 */
export async function callAgent<T>(ctx: EngineContext, call: AgentCall<T>): Promise<AgentCallResult<T>> {
  const first = await runOnce(ctx, call, call.prompt)
  const parsed = call.parse.safeParse(first.structured)
  if (parsed.success) return { value: parsed.data, run: first.run }
  const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
  const retryPrompt = `${call.prompt}\n\nYour previous structured output was rejected by validation (${issues}). Return the structured output again, exactly matching the schema.`
  const second = await runOnce(ctx, call, retryPrompt)
  const reparsed = call.parse.safeParse(second.structured)
  if (reparsed.success) return { value: reparsed.data, run: second.run }
  throw new Error(`${call.provider} did not return valid structured output after a retry`)
}

async function runOnce<T>(ctx: EngineContext, call: AgentCall<T>, prompt: string): Promise<{ structured: unknown; run: AgentRunInfo }> {
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
    status: 'running', startedAt: isoNow(), endedAt: null, usage: emptyUsage(), error: null, pid: null, tail: ''
  }
  ctx.store.putRun(run)
  updateTask(ctx, call.taskId, (t) => { t.usage.agentRuns += 1 })

  let structured: unknown
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
    pending += `${text}\n`
    if (!flushTimer) flushTimer = setTimeout(flush, OUTPUT_FLUSH_MS)
  }

  const policy = policyFor(task.mode)
  // A single run may never outlive the task's remaining active-time budget.
  const timeoutMs = Math.max(1000, Math.min(policy.agentTimeoutMinutes * 60_000, remainingActiveMs(task)))
  let finished: { status: 'succeeded' | 'failed' | 'canceled' | 'timed_out'; detail: string | null } = { status: 'failed', detail: 'Agent ended without a result' }
  try {
    for await (const event of adapter.run({
      cwd: call.cwd, prompt, role: call.role, access: call.access, outputSchema: call.jsonSchema,
      model: null, maxBudgetUsd: remainingUsd(task), timeoutMs
    }, runAbort.signal)) {
      switch (event.type) {
        case 'started':
          if (event.pid) { run = { ...run, pid: event.pid }; ctx.store.putRun(run) }
          break
        case 'text': emitText(event.text); break
        case 'tool': emitText(`› ${event.name} ${event.summary}`); break
        case 'error': emitText(`⚠ ${event.message}`); break
        case 'structured': structured = event.value; break
        case 'usage': {
          run = { ...run, model: event.model ?? run.model, usage: addUsage(run.usage, event) }
          const updated = updateTask(ctx, call.taskId, (t) => { t.usage = { ...addUsage(t.usage, event), agentRuns: t.usage.agentRuns } })
          try { assertWithinBudget(updated, updated.usage) } catch (error) {
            budgetError = error as BudgetExceededError
            runAbort.abort()
          }
          break
        }
        case 'finished': finished = { status: event.status, detail: event.detail }; break
        default: break
      }
    }
  } finally {
    if (flushTimer) clearTimeout(flushTimer)
    flush()
    call.signal.removeEventListener('abort', forward)
    release()
  }

  const status: AgentRunInfo['status'] = finished.status === 'succeeded' ? 'succeeded' : finished.status === 'canceled' ? 'canceled' : 'failed'
  run = { ...run, status, endedAt: isoNow(), error: budgetError?.message ?? (status === 'succeeded' ? null : finished.detail) }
  ctx.store.putRun(run)

  if (budgetError) throw budgetError
  if (call.signal.aborted || finished.status === 'canceled') throw new CanceledError()
  if (finished.status === 'failed' && isProviderLimit(finished.detail ?? '')) throw new ProviderUnavailableError(`${adapter.displayName} is not accepting work right now: ${finished.detail}`)
  if (finished.status !== 'succeeded') throw new Error(`${adapter.displayName} ${finished.status === 'timed_out' ? 'timed out' : 'failed'}: ${finished.detail ?? 'no detail'}`)
  return { structured, run }
}
