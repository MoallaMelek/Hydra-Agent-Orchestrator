import { useState } from 'react'
import { ChevronDown, ChevronRight, Send, Wrench } from 'lucide-react'
import { routeRequest, type AgentRunInfo, type Task } from '@hydra/protocol'
import { Button } from '../../design/components'
import { useApp, useAppState } from '../../app/context'
import { Markdown } from '../../lib/markdown'
import { FriendlyError } from '../../lib/explain'
import { ago, duration, money, tokens } from '../../lib/format'
import { DecisionBar } from './DecisionBar'
import { AgentsTab } from './AgentsTab'
import { ActivityTab } from './ActivityTab'
import { DEPTH_LABEL } from '../NewTaskForm'
import { useNow, useProviderName, useTaskRuns } from '../../ops/hooks'
import { filesOf, shortTarget } from '../../ops/model'

/**
 * A question and its answer, shown as a conversation. One agent works here, so the
 * operations view shrinks to one line: who is answering and what it is looking at.
 */
export function ConversationView({ task }: { task: Task }) {
  const { run, go } = useApp()
  const providerName = useProviderName()
  const runs = useTaskRuns(task.id)
  const draft = useAppState((s) => s.drafts[task.id])
  const project = useAppState((s) => s.projects.find((p) => p.id === task.projectId))
  const tasks = useAppState((s) => s.tasks)
  const [details, setDetails] = useState(false)
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState<'follow' | 'change' | null>(null)
  const thinking = task.status === 'running' || task.status === 'queued'
  const used = task.usage.inputTokens + task.usage.outputTokens

  // Earlier turns of this conversation, oldest first.
  const earlier: Task[] = []
  for (let id = task.followUpOf; id && earlier.length < 10;) {
    const previous: Task | undefined = tasks[id]
    if (!previous) break
    earlier.unshift(previous)
    id = previous.followUpOf
  }

  const ask = async () => {
    const text = followUp.trim()
    const route = routeRequest(text)
    setBusy('follow')
    // A follow-up that asks for a change starts a change, with the conversation as context.
    const command = route.depth === 'deep' && project?.isGit
      ? { type: 'task.create', projectId: task.projectId, depth: 'deep', mode: 'safe', assignment: task.assignment,
          prompt: `${text}\n\n(Context from our conversation)\nQuestion: ${task.prompt}\nAnswer: ${(task.answer ?? '').slice(0, 3000)}` }
      : { type: 'task.create', projectId: task.projectId, prompt: text, depth: route.depth === 'deep' ? 'standard' : 'auto', followUpOf: task.id, mode: task.mode, assignment: task.assignment }
    const ack = await run(command)
    setBusy(null)
    if (ack.ok) { setFollowUp(''); go({ view: 'task', taskId: (ack.result as Task).id }) }
  }

  const makeChange = async () => {
    setBusy('change')
    const ack = await run({ type: 'task.create', projectId: task.projectId, prompt: task.prompt, depth: 'deep', mode: 'safe', assignment: task.assignment })
    setBusy(null)
    if (ack.ok) go({ view: 'task', taskId: (ack.result as Task).id })
  }

  const turn = (t: Task, live: boolean) => (
    <div key={t.id}>
      <div className="chat__msg chat__msg--user">
        <div className="chat__who">You · {ago(t.createdAt)}</div>
        <div className="prose">{t.prompt}</div>
      </div>
      <div className="chat__msg">
        <div className="chat__who">
          {providerName(t.assignment.planner)}
          {t.route && <span className="chat__route" title={t.route.reason}>{DEPTH_LABEL[t.route.depth]}{t.route.auto ? ' · chosen by Hydra' : ''}</span>}
        </div>
        {live && thinking && <AnswerStatus task={t} runs={runs} />}
        {live && thinking && draft && <Markdown text={draft} />}
        {t.answer && !(live && thinking) && <Markdown text={t.answer} />}
        {live && !thinking && !t.answer && t.error && <FriendlyError message={t.error} status={t.status} />}
        {live && t.status === 'canceled' && <p className="muted">Stopped before answering.</p>}
        {live && !thinking && <LookedAt runs={runs} />}
      </div>
    </div>
  )

  return (
    <section className="hx-panel chat">
      {earlier.map((t) => turn(t, false))}
      {turn(task, true)}
      <div className="chat__foot">
        <span className="faint num">
          {!thinking && duration(Date.parse(task.updatedAt) - Date.parse(task.createdAt))}
          {used ? ` · ${money(task.usage.costUsd)} · ${tokens(used)} tokens` : ''}
        </span>
        <div className="row">
          <button type="button" className="chat__toggle" aria-expanded={details} onClick={() => setDetails(!details)}>
            {details ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Details
          </button>
          {!thinking && task.answer && project?.isGit && (
            <Button size="sm" icon={<Wrench size={14} />} busy={busy === 'change'} onClick={() => void makeChange()} title="Run the full pipeline on this request: plan, isolated edit, review, tests, your approval">Make this change</Button>
          )}
          <DecisionBar task={task} blockingWarnings={0} />
        </div>
      </div>
      {!thinking && (
        <div className="chat__reply">
          <textarea className="hx-textarea" rows={2} aria-label="Ask a follow-up" placeholder="Ask a follow-up…" value={followUp}
            onChange={(e) => setFollowUp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && followUp.trim()) { e.preventDefault(); void ask() } }} />
          <Button variant="primary" icon={<Send size={14} />} busy={busy === 'follow'} disabled={!followUp.trim()} onClick={() => void ask()}>Send</Button>
        </div>
      )}
      {details && (
        <div className="hx-panel__body stack">
          <h4>Agent runs</h4>
          <AgentsTab runs={runs} />
          <h4>Log</h4>
          <ActivityTab task={task} />
        </div>
      )}
    </section>
  )
}

const VERB = { read: 'Reading', search: 'Searching for', edit: 'Editing', command: 'Running', other: 'Using' } as const

/** While the answer is being written: who is working, on what, for how long. No spinner. */
function AnswerStatus({ task, runs }: { task: Task; runs: AgentRunInfo[] }) {
  const current = runs.filter((r) => r.status === 'running').at(-1)
  const last = useAppState((s) => (current ? s.activity[current.id]?.at(-1) : undefined))
  const now = useNow(true)
  const since = Date.parse(current?.startedAt ?? task.createdAt)
  const text = task.status === 'queued' ? 'Starting' : last ? `${VERB[last.kind]} ${shortTarget(last.target, 70)}` : current ? 'Thinking' : 'Starting the agent'
  return <p className="answer-status" role="status"><span className="answer-status__dot" aria-hidden />{text}<span className="faint num"> · {duration(Math.max(0, now - since))}</span></p>
}

/** After the answer: what the agent actually opened, from its reported tool calls. */
function LookedAt({ runs }: { runs: AgentRunInfo[] }) {
  const [open, setOpen] = useState(false)
  const activity = runs.flatMap((r) => r.activity ?? [])
  if (!activity.length) return null
  const files = filesOf(activity)
  const count = files.inspected.length + files.modified.length
  return (
    <div className="looked-at">
      <button type="button" className="chat__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {count ? `Read ${count} file${count === 1 ? '' : 's'}` : 'Tool calls'} · {activity.length} tool call{activity.length === 1 ? '' : 's'}
      </button>
      {open && <ul className="looked-at__list">{[...files.inspected, ...files.commands].slice(0, 30).map((f) => <li key={f} className="mono truncate" title={f}>{shortTarget(f, 80)}</li>)}</ul>}
    </div>
  )
}
