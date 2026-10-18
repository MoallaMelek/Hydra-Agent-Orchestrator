import { approvalContext, verificationReceipt, type Evidence, type Task } from '@hydra/protocol'
import { Badge } from '../../design/components'
import { shortSha } from '../../lib/format'
import { Markdown } from '../../lib/markdown'

/** A readable decision artifact made only from recorded engine state. */
export function MissionReceipt({ task, evidence }: { task: Task; evidence: Evidence[] }) {
  const receipt = verificationReceipt(task, evidence)
  const approval = approvalContext(task, evidence)
  const final = task.stage === 'approval' || Boolean(task.outcome)
  return <section className="mission-story" aria-label="Mission receipt">
    <div className="mission-request"><span>Your request</span><p>{task.prompt.length > 500 ? task.prompt.slice(0, 500) + '…' : task.prompt}</p>{task.prompt.length > 500 && <details><summary>Read full request</summary><p>{task.prompt}</p></details>}</div>
    <div className="mission-response"><h2>{task.outcome === 'applied' ? 'Applied to your project' : task.status === 'waiting_input' ? 'Over to you' : task.status === 'paused' || task.status === 'failed' ? 'Let’s recover this work' : task.status === 'completed' ? 'The work is saved' : 'From idea to evidence'}</h2>
      {task.answer ? <Markdown text={task.answer} /> : <p className="muted">{task.review?.summary ?? task.plan?.summary ?? (task.status === 'queued' ? 'Waiting to start. No agent work has been reported yet.' : 'Hydra will record the plan, changes and check results here as they become available.')}</p>}
    </div>
    <div className="mission-receipt">
      <div className="mission-receipt__heading"><h3>Mission receipt</h3><Badge tone={!final ? 'neutral' : receipt.state === 'passed' ? 'ok' : receipt.state === 'failed' ? 'bad' : 'warn'}>{!final ? 'Work in progress' : receipt.state === 'passed' ? 'Checks passed' : receipt.state === 'failed' ? 'Checks failed' : 'Unverified'}</Badge></div>
      <dl><div><dt>Revision</dt><dd>{receipt.revision ? <code>{shortSha(receipt.revision)}</code> : 'Not recorded yet'}</dd></div><div><dt>Review</dt><dd>{task.review ? task.review.verdict === 'approve' ? 'Reviewer approved' : 'Changes requested' : 'Not recorded yet'}</dd></div><div><dt>Final checks</dt><dd>{receipt.passed.length} passed · {receipt.failed.length} failed · {receipt.missing.length} not recorded{!task.checks.length && ' · no checks configured'}</dd></div><div><dt>Project files</dt><dd>{task.outcome === 'applied' ? 'Updated after your approval' : task.outcome === 'rolled_back' ? 'Reverted with a new commit' : 'This task has not been applied'}</dd></div></dl>
      <p className="faint">Checks describe observed commands at this revision. They do not guarantee correctness. Agents take turns within a task; separate tasks can overlap.</p>
      {task.applied && <div className="mission-decision" role="status">
        <b>{task.acceptance ? 'Accepted with passing checks and reviewer approval' : 'Historical application · no enforced acceptance receipt'}</b>
        {task.acceptance ? <p>Decision {task.acceptance.decisionId} · {task.acceptance.at} · {task.acceptance.actor} ({task.acceptance.source}) · revision <code>{shortSha(task.acceptance.revision)}</code> · {task.acceptance.evidenceIds.length} check result(s). No exception was used.</p> : <p>This older task was applied under the previous approval policy. It is not retroactively certified by the new policy.</p>}
        {!approval.allowed && <div role="alert"><b>Unresolved conditions in the current record{receipt.state === 'failed' ? ' · applied despite failed checks' : ''}</b><ul>{approval.unresolved.map((reason, i) => <li key={i}>{reason}</li>)}</ul></div>}
      </div>}
    </div>
  </section>
}
