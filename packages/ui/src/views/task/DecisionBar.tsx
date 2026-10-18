import { useState } from 'react'
import { Archive, ArchiveRestore, Check, GitBranch, MessageSquareText, Play, RotateCcw, Square, Trash2, X } from 'lucide-react'
import type { Task } from '@hydra/protocol'
import { approvalContext, newAcceptanceId, verificationReceipt } from '@hydra/protocol'
import { useAppState } from '../../app/context'
import { Button, Dialog, Field } from '../../design/components'
import { useApp } from '../../app/context'
import { shortSha } from '../../lib/format'
import { useDraft } from '../../app/preferences'

/** The human control point: what Hydra is waiting for and the actions available right now. */
export function DecisionBar({ task, blockingWarnings }: { task: Task; blockingWarnings: number }) {
  const { run, go, isRemote } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [changes, setChanges] = useState(false)
  const feedbackDraft = useDraft(`feedback:${task.id}`)
  const feedback = feedbackDraft.text
  const setFeedback = (text: string) => feedbackDraft.set({ text })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const evidence = useAppState(s => s.evidence[task.id])
  const loaded = useAppState(s => Boolean(s.loaded[task.id]))
  const receipt = verificationReceipt(task, evidence ?? [])
  const approval = approvalContext(task, evidence ?? [])
  const act = async (key: string, command: Record<string, unknown>, success?: string) => {
    setBusy(key)
    const ack = await run({ taskId: task.id, ...command }, success)
    setBusy(null)
    return ack
  }

  if (task.status === 'waiting_input' && task.waitReason === 'plan_approval') {
    return (
      <div className="decision">
        <div className="decision__text"><b>Approve the plan and checks?</b><span className="muted">Agents have only read the code so far. Approving lets the implementer edit files in the isolated worktree, and lets Hydra run the listed check commands.</span></div>
        <Button variant="danger" icon={<X size={15} />} busy={busy === 'reject'} onClick={() => void act('reject', { type: 'task.approve_plan', approve: false }, 'Plan rejected; workspace discarded')}>Reject</Button>
        <Button variant="primary" icon={<Check size={15} />} busy={busy === 'approve'} onClick={() => void act('approve', { type: 'task.approve_plan', approve: true }, 'Plan approved')}>Approve plan &amp; checks</Button>
      </div>
    )
  }

  if (task.status === 'waiting_input' && task.waitReason === 'final_approval') {
    const head = task.workspace?.headSha
    return (
      <>
        <div className="decision">
          <div className="decision__text">
            <b>{!loaded ? 'Loading check evidence…' : receipt.state === 'passed' ? 'Checks passed · your decision' : receipt.state === 'failed' ? 'Checks failed · review before applying' : 'Unverified change · review before applying'}</b>
            <span className="muted">{task.error ?? 'Accept applies only this exact revision with current passing checks and reviewer approval. Passing checks do not prove correctness.'}</span>
            {receipt.failed.length > 0 && <span role="alert">Failed: {receipt.failed.map(c => c.spec.label).join(', ')}</span>}
            {receipt.missing.length > 0 && <span role="alert">No current result: {receipt.missing.map(c => c.spec.label).join(', ')}</span>}
            {!task.checks.length && <span role="alert">No checks configured. Behaviour has not been verified.</span>}
            <small className="faint">Reviewed revision <code>{shortSha(head)}</code> · applies by fast-forward only</small>
            {loaded && !approval.allowed && <div role="alert"><b>Acceptance blocked</b><ul>{approval.unresolved.map((reason, i) => <li key={i}>{reason}</li>)}</ul><span>Request changes, keep the isolated branch, or reject. Applying by exception is not supported.</span></div>}
            {blockingWarnings > 0 && <small>Review the additional warnings below before deciding.</small>}
          </div>
          <Button variant="ghost" icon={<GitBranch size={15} />} busy={busy === 'keep'} onClick={() => void act('keep', { type: 'task.decide', decision: 'keep_branch' }, 'Branch kept for manual merge')}>Keep branch</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} busy={busy === 'reject'} onClick={() => void act('reject', { type: 'task.decide', decision: 'reject' }, 'Discarded')}>Reject</Button>
          <Button icon={<MessageSquareText size={15} />} onClick={() => setChanges(true)}>Request changes</Button>
          <Button variant="primary" icon={<Check size={15} />} busy={busy === 'accept'} disabled={!head || !loaded || !approval.allowed}
            title={blockingWarnings ? 'There are unresolved warnings; read them before accepting.' : undefined}
            onClick={() => void act('accept', { type: 'task.decide', decision: 'accept', headSha: head, acceptance: { decisionId: newAcceptanceId(), snapshot: approval.snapshot } }, 'Applying to your branch…')}>
            {loaded && !approval.allowed ? 'Acceptance blocked' : 'Accept'}
          </Button>
        </div>
        <Dialog open={changes} onClose={() => setChanges(false)} title="Request changes"
          footer={<><Button onClick={() => setChanges(false)}>Cancel</Button><Button variant="primary" disabled={!feedback.trim()} busy={busy === 'changes'}
            onClick={() => void act('changes', { type: 'task.decide', decision: 'request_changes', feedback }, 'Sent to the implementer').then((ack) => { if (ack.ok) { setChanges(false); setFeedback('') } })}>Send</Button></>}>
          <Field label="What should change?" htmlFor="feedback" hint="The implementer receives this as its highest-priority instruction, then the change is reviewed and verified again.">
            <textarea id="feedback" className="hx-textarea" rows={5} value={feedback} onChange={(e) => setFeedback(e.target.value)} autoFocus />
          </Field>
        </Dialog>
      </>
    )
  }

  if (task.status === 'running' || task.status === 'queued') {
    return <div className="row"><Button variant="danger" icon={<Square size={13} />} busy={busy === 'cancel'} disabled={task.stage === 'apply'} onClick={() => void act('cancel', { type: 'task.cancel' }, 'Canceling…')}>Stop</Button></div>
  }

  return (
    <div className="row" style={{ flexWrap: 'wrap' }}>
      {(task.status === 'paused' || task.status === 'failed') && <Button variant="primary" icon={<Play size={15} />} busy={busy === 'resume'} onClick={() => void act('resume', { type: 'task.resume' })}>Resume</Button>}
      {task.outcome === 'applied' && task.applied?.method === 'fast_forward' && <Button icon={<RotateCcw size={15} />} busy={busy === 'rollback'} onClick={() => void act('rollback', { type: 'task.rollback' }, 'Rolled back with a revert commit')}>Roll back</Button>}
      <Button variant="ghost" icon={task.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />} busy={busy === 'archive'}
        onClick={() => void act('archive', { type: 'task.archive', archived: !task.archivedAt }, task.archivedAt ? 'Restored to history' : 'Archived')}>{task.archivedAt ? 'Restore' : 'Archive'}</Button>
      {!isRemote && <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setConfirmDelete(true)}>Delete</Button>}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this task?"
        footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" busy={busy === 'delete'}
          onClick={() => void act('delete', { type: 'task.delete' }, 'Task removed from history').then((ack) => { setConfirmDelete(false); if (ack.ok) go({ view: 'project', projectId: task.projectId }) })}>Remove from history</Button></>}>
        <p>This removes the task from visible history and deletes its current task records and logs. Historical journal entries, backups and exports can retain its content. This is not secure erasure. Accepted changes stay in your repository. Use Archive to hide the task without removing its current records.</p>
      </Dialog>
    </div>
  )
}
