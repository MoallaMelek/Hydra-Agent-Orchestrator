import type { Task, UsageTotals } from '@hydra/protocol'
import { BudgetExceededError } from '../util/errors.js'

export interface UsageDelta { inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number | null }

/**
 * Adds a usage report. Runs without a provider-reported price (Codex CLI) add to
 * `unpricedTokens` instead of pretending to cost $0; they are bounded by tokens.
 */
export function addUsage(total: UsageTotals, delta: UsageDelta): UsageTotals {
  return {
    ...total,
    inputTokens: total.inputTokens + delta.inputTokens,
    outputTokens: total.outputTokens + delta.outputTokens,
    cachedTokens: total.cachedTokens + delta.cachedTokens,
    costUsd: total.costUsd + (delta.costUsd ?? 0),
    unpricedTokens: total.unpricedTokens + (delta.costUsd === null ? delta.inputTokens + delta.outputTokens + delta.cachedTokens : 0)
  }
}

/** All reported tokens, including cached input. This count is not a price estimate. */
export const billableTokens = (usage: UsageTotals): number => usage.inputTokens + usage.outputTokens + usage.cachedTokens

/** Throws if starting another agent run would violate the task budget (limits are inclusive). */
export function assertCanStartRun(task: Task, now: number = Date.now()): void {
  const b = task.budget
  if (task.usage.agentRuns >= b.maxAgentRuns) throw new BudgetExceededError(`Agent run limit reached (${b.maxAgentRuns})`)
  if (task.usage.costUsd >= b.maxCostUsd) throw new BudgetExceededError(`Cost limit reached: $${task.usage.costUsd.toFixed(2)} of $${b.maxCostUsd.toFixed(2)}`)
  if (billableTokens(task.usage) >= b.maxTokens) throw new BudgetExceededError(`Token limit reached: ${billableTokens(task.usage)} of ${b.maxTokens}`)
  assertWithinBudget(task, task.usage, now)
}

/** Throws if the given usage (task total including the current run) exceeds any limit. */
export function assertWithinBudget(task: Task, usage: UsageTotals, now: number = Date.now()): void {
  const b = task.budget
  if (usage.costUsd > b.maxCostUsd) throw new BudgetExceededError(`Cost limit exceeded: $${usage.costUsd.toFixed(2)} > $${b.maxCostUsd.toFixed(2)}`)
  if (billableTokens(usage) > b.maxTokens) throw new BudgetExceededError(`Token limit exceeded: ${billableTokens(usage)} > ${b.maxTokens}`)
  const activeMin = activeMinutes(task, now)
  if (activeMin > b.maxWallMinutes) throw new BudgetExceededError(`Time limit exceeded: ${activeMin.toFixed(0)} min of active work > ${b.maxWallMinutes} min`)
}

/** Time spent inside stages; time spent waiting for a human does not count. */
export function activeMinutes(task: Task, now: number = Date.now()): number {
  let ms = 0
  for (const record of task.stages) {
    const end = record.endedAt ? Date.parse(record.endedAt) : now
    ms += Math.max(0, end - Date.parse(record.startedAt))
  }
  return ms / 60_000
}

/** Active-time budget left, in milliseconds (used to cap individual runs). */
export function remainingActiveMs(task: Task, now: number = Date.now()): number {
  return Math.max(0, task.budget.maxWallMinutes * 60_000 - activeMinutes(task, now) * 60_000)
}

/** Dollars still available for a single run, passed to providers that support a hard cap. */
export const remainingUsd = (task: Task): number => Math.max(0, task.budget.maxCostUsd - task.usage.costUsd)
