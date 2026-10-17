import type { Evidence, Task } from './domain.js'

/** Process evidence at the proposed revision, never an agent's assertion. */
export function verificationReceipt(task: Task, evidence: readonly Evidence[]) {
  const revision = task.workspace?.headSha
  const latest = new Map<string, Evidence>()
  for (const e of [...evidence].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    if (revision && e.phase === 'verify' && e.commitSha === revision) latest.set(e.checkId, e)
  }
  const checks = task.checks.map(spec => {
    const result = latest.get(spec.id)
    const state = !result ? 'missing' : result.exitCode === 0 && !result.timedOut && !result.spawnError && !result.treeMutated ? 'passed' : 'failed'
    return { spec, result, state } as const
  })
  const failed = checks.filter(c => c.state === 'failed')
  const missing = checks.filter(c => c.state === 'missing')
  const passed = checks.filter(c => c.state === 'passed')
  const state = failed.length ? 'failed' : missing.length || !checks.length || !revision ? 'unverified' : 'passed'
  return { revision, checks, failed, missing, passed, state } as const
}
