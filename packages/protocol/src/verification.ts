import type { CheckSpec, Evidence, Task } from './domain.js'

export const checkSpecBinding = (c: CheckSpec) => JSON.stringify([c.id, c.ecosystem, c.label, c.kind, c.argv, c.cwd, c.timeoutSec, c.required])

/** getRandomValues also works on the existing HTTP LAN client; randomUUID does not. */
export function newAcceptanceId(): string {
  const bytes = (globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }).crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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

/** Exact, canonical decision context, compared by the engine rather than trusted from clients.
 * This is a binding, not a secret or an authorization token. Include complete check/results
 * and review records so replacing evidence at the same SHA invalidates an open decision.
 */
export function approvalContext(task: Task, evidence: readonly Evidence[]) {
  const receipt = verificationReceipt(task, evidence)
  const unresolved: string[] = []
  if (task.mode === 'safe' && !task.checksApproved) unresolved.push('Safe-mode checks have not been approved.')
  if (!task.checks.length) unresolved.push('No verification checks are configured.')
  const reviewStage = task.stages.filter(s => s.stage === 'review').at(-1)
  const verifyStage = task.stages.filter(s => s.stage === 'verify').at(-1)
  if (reviewStage?.status !== 'succeeded' || verifyStage?.status !== 'succeeded') unresolved.push('Review and verification must finish successfully before acceptance.')
  for (const c of receipt.checks) {
    if (c.state !== 'passed') unresolved.push(`${c.spec.label}: ${c.state === 'missing' ? 'no final result at this revision' : 'failed or untrusted result'}.`)
    if (c.result && (c.result.taskId !== task.id || c.result.required !== c.spec.required)) unresolved.push(`${c.spec.label}: evidence does not match this task/check policy.`)
    if (c.result && (c.result.checkSpec !== checkSpecBinding(c.spec) || !verifyStage?.endedAt || c.result.startedAt < verifyStage.startedAt || c.result.startedAt > verifyStage.endedAt)) unresolved.push(`${c.spec.label}: evidence is stale or its command definition is untrusted.`)
    if (c.result?.definitionsChanged) unresolved.push(`${c.spec.label}: check definitions changed since planning; the result cannot authorize application.`)
  }
  if (!task.review) unresolved.push('No reviewer decision is recorded.')
  if (task.review?.verdict !== 'approve' || task.review?.findings.some(f => f.severity === 'blocker' || f.severity === 'major')) unresolved.push('Reviewer approval is unresolved.')
  if (task.review?.acceptanceCriteriaMet.some(c => !c.met)) unresolved.push('The reviewer reports unmet acceptance criteria.')
  if (!receipt.revision || task.reviewedSha !== receipt.revision) unresolved.push('Review does not cover this revision.')
  const evidenceIds = receipt.checks.flatMap(c => c.result ? [c.result.id] : []).sort()
  const snapshot = JSON.stringify({ version: 1, taskId: task.id, mode: task.mode, revision: receipt.revision,
    baseSha: task.workspace?.baseSha, checks: task.checks, checkDigest: task.checkDigest,
    review: task.review, reviewedSha: task.reviewedSha ?? null,
    stages: task.stages.filter(s => s.stage === 'review' || s.stage === 'verify'),
    // Bind result facts and output digest, not the large redacted display tail.
    results: receipt.checks.map(c => { if (!c.result) return null; const { outputTail: _tail, ...facts } = c.result; return facts }) })
  return { snapshot, unresolved, evidenceIds, allowed: unresolved.length === 0 }
}
