import type { Task, TaskStatus, UsageTotals } from '@hydra/protocol'
import type { Tone } from '../design/components'

export const money = (usd: number): string => (usd < 0.01 && usd > 0 ? '<$0.01' : `$${usd.toFixed(2)}`)

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

export const shortSha = (sha: string | null | undefined): string => (sha ? sha.slice(0, 8) : '—')

export function usageLine(usage: UsageTotals): string {
  const parts = [money(usage.costUsd)]
  if (usage.unpricedTokens) parts.push(`+${tokens(usage.unpricedTokens)} unpriced tokens`)
  parts.push(`${usage.agentRuns} run${usage.agentRuns === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export function statusLabel(task: Task): { label: string; tone: Tone; live: boolean } {
  const map: Record<TaskStatus, { label: string; tone: Tone }> = {
    queued: { label: 'Queued', tone: 'neutral' },
    running: { label: 'Running', tone: 'accent' },
    waiting_input: { label: 'Needs you', tone: 'warn' },
    paused: { label: 'Paused', tone: 'info' },
    completed: { label: 'Done', tone: 'ok' },
    failed: { label: 'Failed', tone: 'bad' },
    canceled: { label: 'Canceled', tone: 'neutral' }
  }
  const base = map[task.status]
  if (task.status === 'waiting_input') return { label: task.waitReason === 'plan_approval' ? 'Approve plan' : 'Review result', tone: 'warn', live: false }
  if (task.status === 'completed') {
    const outcome = { applied: 'Applied', discarded: 'Discarded', kept_branch: 'Branch kept', answered: 'Answered', rolled_back: 'Rolled back' }[task.outcome ?? 'answered']
    return { label: outcome, tone: task.outcome === 'applied' || task.outcome === 'answered' ? 'ok' : 'neutral', live: false }
  }
  return { ...base, live: task.status === 'running' }
}

export const STAGE_LABELS = { plan: 'Plan', implement: 'Implement', review: 'Review', fix: 'Fix', verify: 'Verify', demo: 'Demo', approval: 'Approval', apply: 'Apply' } as const

export const MODE_INFO = {
  safe: { label: 'Safe', detail: 'You approve the plan and the exact check commands before any code is written. Final approval required.' },
  developer: { label: 'Developer', detail: 'Agents work autonomously inside the isolated worktree. Detected checks run automatically. Final approval required.' },
  autonomous: { label: 'Autonomous', detail: 'Larger budgets and more fix rounds, still inside the worktree and sandboxes. Final approval required.' }
} as const

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)(\/|$)|(\.|_)(test|spec)\.[a-z]+$|^test_.*\.py$|_test\.(go|py)$/i
export const isTestPath = (path: string): boolean => TEST_PATH.test(path)
