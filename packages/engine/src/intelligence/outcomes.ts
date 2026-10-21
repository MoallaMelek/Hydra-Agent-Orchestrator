import type { Assignment, Evidence, Outcome, ProviderId, Task } from '@hydra/protocol'
import { providerFailure } from '../util/errors.js'

const TERMINAL = new Set(['completed', 'failed', 'canceled'])
/** Below this many similar finished tasks, history is shown but does not drive the recommendation. */
export const MIN_EVIDENCE = 5

export const categoryOf = (task: Pick<Task, 'intent' | 'route'>): string =>
  task.intent === 'analyze' ? `answer/${task.route?.depth ?? 'standard'}` : `change/${task.route?.risk ?? 'normal'}`

export const strategyOf = (a: Assignment, intent: Task['intent']): string =>
  intent === 'analyze' ? a.planner : `${a.planner}→${a.implementer}→${a.reviewer}`

/** The record kept for a finished task, or null while it is still in progress. */
export function outcomeFor(task: Task, evidence: readonly Evidence[]): Outcome | null {
  if (!TERMINAL.has(task.status)) return null
  const head = task.workspace?.headSha
  const final = head ? evidence.filter((e) => e.phase === 'verify' && e.commitSha === head && e.required) : []
  const verified = task.intent === 'change' && final.length ? final.every((e) => e.exitCode === 0 && !e.timedOut && !e.spawnError && !e.treeMutated) : null
  const decision: Outcome['decision'] = task.status === 'failed' ? 'failed' : task.status === 'canceled' ? 'canceled'
    : task.outcome === 'applied' ? 'accepted' : task.outcome === 'rolled_back' ? 'rolled_back' : task.outcome === 'kept_branch' ? 'kept_branch'
      : task.outcome === 'answered' ? 'answered' : 'rejected'
  return {
    taskId: task.id, at: task.updatedAt, category: categoryOf(task), strategy: strategyOf(task.assignment, task.intent),
    durationMs: Math.max(0, Date.parse(task.updatedAt) - Date.parse(task.createdAt)),
    tokens: task.usage.inputTokens + task.usage.outputTokens, costUsd: task.usage.unpricedTokens > 0 ? null : task.usage.costUsd,
    verified, fixRounds: task.fixRound, decision,
    failure: task.status === 'failed' && task.error ? providerFailure(task.error) : null
  }
}

export interface StrategyStats { strategy: string; n: number; succeeded: number; medianMinutes: number | null; medianCostUsd: number | null }
export interface Recommendation {
  assignment: Assignment
  strategy: string
  /** 'history': chosen from your own finished tasks; 'rule': no or too little history yet. */
  basis: 'history' | 'rule'
  reason: string
  /** Observations only, per strategy, for this kind of task. */
  evidence: StrategyStats[]
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  xs.sort((a, b) => a - b)
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2
}
/** A change succeeded if you accepted it and Hydra's checks did not fail; an answer if it was given. */
const succeeded = (o: Outcome) => (o.category.startsWith('answer') ? o.decision === 'answered' : o.decision === 'accepted' && o.verified !== false)
/** Canceled tasks and branches kept for later say nothing about how well a setup works. */
const counts = (o: Outcome) => o.decision !== 'canceled' && o.decision !== 'kept_branch'

function parse(strategy: string): Assignment {
  const [planner, implementer = planner, reviewer = planner] = strategy.split('→') as ProviderId[]
  return { planner: planner!, implementer: implementer!, reviewer: reviewer! }
}

/**
 * Suggests who should plan, implement and review. Transparent: a stated rule until there
 * are at least MIN_EVIDENCE similar finished tasks for a strategy, then the strategy with
 * the best observed success, with the counts shown. Never a confidence score.
 */
export function recommend(category: string, available: readonly ProviderId[], history: readonly Outcome[]): Recommendation {
  const answer = category.startsWith('answer')
  const real = available.filter((p) => p !== 'scripted')
  const pool = real.length ? real : available
  const candidates = answer
    ? pool.map((p) => p as string)
    : pool.length > 1 ? ['claude→codex→claude', 'codex→claude→codex', 'claude→claude→claude', 'codex→codex→codex'].filter((s) => s.split('→').every((p) => pool.includes(p as ProviderId))) : [`${pool[0]}→${pool[0]}→${pool[0]}`]
  const evidence: StrategyStats[] = candidates.map((strategy) => {
    const mine = history.filter((o) => o.category === category && o.strategy === strategy && counts(o))
    return {
      strategy, n: mine.length, succeeded: mine.filter(succeeded).length,
      medianMinutes: median(mine.map((o) => o.durationMs / 60_000)), medianCostUsd: median(mine.flatMap((o) => (o.costUsd === null ? [] : [o.costUsd])))
    }
  })
  const proven = evidence.filter((e) => e.n >= MIN_EVIDENCE)
  if (proven.length) {
    const best = [...proven].sort((a, b) => b.succeeded / b.n - a.succeeded / a.n || (a.medianMinutes ?? 1e9) - (b.medianMinutes ?? 1e9))[0]!
    return { assignment: parse(best.strategy), strategy: best.strategy, basis: 'history', evidence,
      reason: `In your last ${best.n} similar tasks this setup succeeded ${best.succeeded} times${best.medianMinutes !== null ? `, typically in ${best.medianMinutes.toFixed(1)} min` : ''}.` }
  }
  const has = (p: ProviderId) => pool.includes(p)
  if (answer) {
    const pick = has('claude') ? 'claude' : pool[0]!
    return { assignment: parse(pick), strategy: pick, basis: 'rule', evidence,
      reason: pick === 'claude' ? 'Claude Code streams its answer as it writes, so replies start sooner.' : 'The only ready agent.' }
  }
  const pick = has('claude') && has('codex') ? 'claude→codex→claude' : candidates[0]!
  return { assignment: parse(pick), strategy: pick, basis: 'rule', evidence,
    reason: pick === 'claude→codex→claude'
      ? 'Different providers write and review the change, so the review is more independent. Not enough history yet to compare setups.'
      : 'The only ready agent. With both Claude Code and Codex, the review would be more independent.' }
}
