import { approvalContext, checkSpecBinding, verificationReceipt, type Evidence, type Task } from '@hydra/protocol'
import { shortSha } from '../../lib/format'

/** The product's signature: recorded artifacts, not a simulated team or a percentage. */
export function Proofline({ task, evidence, connected, onInspect }: { task: Task; evidence: Evidence[]; connected: boolean; onInspect: (tab: 'summary' | 'changes' | 'checks') => void }) {
  const receipt = verificationReceipt(task, evidence)
  const approval = approvalContext(task, evidence)
  const reviewStage = task.stages.filter(s => s.stage === 'review').at(-1)
  const verifyStage = task.stages.filter(s => s.stage === 'verify').at(-1)
  const checksCurrent = verifyStage?.status === 'succeeded' && receipt.checks.length > 0 && receipt.checks.every(({spec, result}) => result && result.taskId === task.id && result.required === spec.required && result.checkSpec === checkSpecBinding(spec) && !result.definitionsChanged && verifyStage.endedAt && result.startedAt >= verifyStage.startedAt && result.startedAt <= verifyStage.endedAt)
  const records: Array<{ label: string; detail: string; tab: 'summary' | 'changes' | 'checks'; tone?: string }> = []
  if (task.plan) records.push({ label: 'Plan recorded', detail: `${task.plan.steps.length} steps`, tab: 'summary' })
  if (task.workspace?.headSha && task.workspace.headSha !== task.workspace.baseSha) records.push({ label: 'Revision saved', detail: shortSha(task.workspace.headSha), tab: 'changes' })
  if (task.review) {
    const current = reviewStage?.status === 'succeeded' && Boolean(receipt.revision) && task.reviewedSha === receipt.revision
    const approved = current && task.review.verdict === 'approve' && !task.review.findings.some(f => f.severity === 'blocker' || f.severity === 'major') && task.review.acceptanceCriteriaMet.every(c => c.met)
    records.push({ label: 'Review recorded', detail: !current ? 'Stale or incomplete review' : approved ? 'Reviewer approved' : 'Changes requested', tab: 'summary', tone: approved ? 'neutral' : 'bad' })
  }
  if (receipt.checks.some(c => c.result) || task.stages.some(s => s.stage === 'verify' && s.status === 'succeeded')) records.push({ label: 'Checks recorded', detail: !checksCurrent ? 'Stale, missing or untrusted' : receipt.state === 'passed' ? `${receipt.passed.length} passed` : receipt.state === 'failed' ? `${receipt.failed.length} failed or untrusted` : 'Missing current evidence', tab: 'checks', tone: checksCurrent && receipt.state === 'passed' ? 'ok' : 'bad' })
  if (task.acceptance) records.push({ label: 'Decision recorded', detail: task.acceptance.actor, tab: 'summary' })
  else if (task.waitReason === 'final_approval') records.push({ label: 'Your decision', detail: approval.allowed ? 'Ready to apply' : 'Repair needed', tab: 'checks', tone: approval.allowed ? 'neutral' : 'bad' })
  if (task.applied) records.push({ label: task.outcome === 'rolled_back' ? 'Revert recorded' : 'Delivery recorded', detail: shortSha(task.applied.rolledBackSha ?? task.applied.afterSha), tab: 'changes' })
  if (!records.length) return null
  return <section className="proofline" aria-label="Recorded handoffs">
    <div className="proofline__intro"><h2>From request to proof</h2><span className="faint">{connected ? 'Recorded artifacts · select to inspect' : 'Saved record · connection unavailable'}</span></div>
    <ol>{records.map((record, i) => <li key={`${record.label}-${i}`}><button className={record.tone ? `tone-${record.tone}` : ''} onClick={() => onInspect(record.tab)} aria-controls="task-inspector"><span className="proofline__joint" aria-hidden /><strong>{record.label}</strong><small>{record.detail}</small></button></li>)}</ol>
  </section>
}
