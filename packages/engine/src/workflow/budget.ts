import type { Task, UsageTotals } from '@hydra/protocol'
import { BudgetExceededError } from '../util/errors.js'

export function addUsage(total: UsageTotals, delta: { inputTokens: number; outputTokens: number; cachedTokens: number; costUsd: number | null }): UsageTotals {
  return {
    ...total,
    inputTokens: total.inputTokens + delta.inputTokens,
    outputTokens: total.outputTokens + delta.outputTokens,
    cachedTokens: total.cachedTokens + delta.cachedTokens,
    costUsd: total.costUsd + (delta.costUsd ?? 0),
    costEstimated: total.costEstimated || delta.costUsd === null
  }
}

export const billableTokens = (usage: UsageTotals): number => usage.inputTokens + usage.outputTokens

/** Throws if starting another agent run would violate the task budget. */
export function assertCanStartRun(task: Task, now: number = Date.now()): void {
  const b = task.budget
  if (task.usage.agentRuns >= b.maxAgentRuns) throw new BudgetExceededError(`Agent run limit reached (${b.maxAgentRuns})`)
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

/** Dollars still available for a single run, passed to providers that support a hard cap. */
export const remainingUsd = (task: Task): number => Math.max(0, task.budget.maxCostUsd - task.usage.costUsd)
