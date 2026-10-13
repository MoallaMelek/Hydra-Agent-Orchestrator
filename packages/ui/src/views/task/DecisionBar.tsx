import { useState } from 'react'
import { Check, GitBranch, MessageSquareText, Play, RotateCcw, Square, Trash2, X } from 'lucide-react'
import type { Task } from '@hydra/protocol'
import { Button, Dialog, Field } from '../../design/components'
import { useApp } from '../../app/context'
import { shortSha } from '../../lib/format'

/** The human control point: what Hydra is waiting for and the actions available right now. */
export function DecisionBar({ task, blockingWarnings }: { task: Task; blockingWarnings: number }) {
  const { run, go } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [changes, setChanges] = useState(false)
  const [feedback, setFeedback] = useState('')
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
            <b>Review the result at <code>{shortSha(head)}</code></b>
            <span className="muted">{task.error ?? 'Accept fast-forwards your branch to exactly this commit. Nothing has been written to your branch yet.'}</span>
          </div>
          <Button variant="ghost" icon={<GitBranch size={15} />} busy={busy === 'keep'} onClick={() => void act('keep', { type: 'task.decide', decision: 'keep_branch' }, 'Branch kept for manual merge')}>Keep branch</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} busy={busy === 'reject'} onClick={() => void act('reject', { type: 'task.decide', decision: 'reject' }, 'Discarded')}>Reject</Button>
          <Button icon={<MessageSquareText size={15} />} onClick={() => setChanges(true)}>Request changes</Button>
          <Button variant="primary" icon={<Check size={15} />} busy={busy === 'accept'} disabled={!head}
            title={blockingWarnings ? 'There are unresolved warnings; read them before accepting.' : undefined}
            onClick={() => void act('accept', { type: 'task.decide', decision: 'accept', headSha: head }, 'Applying to your branch…')}>
            Accept{blockingWarnings ? ` (${blockingWarnings} warning${blockingWarnings > 1 ? 's' : ''})` : ''}
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
      {task.status !== 'running' && <Button variant="ghost" icon={<Trash2 size={15} />} busy={busy === 'delete'} onClick={() => void act('delete', { type: 'task.delete' }, 'Task deleted').then((ack) => ack.ok && go({ view: 'project', projectId: task.projectId }))}>Delete task</Button>}
    </div>
  )
}
