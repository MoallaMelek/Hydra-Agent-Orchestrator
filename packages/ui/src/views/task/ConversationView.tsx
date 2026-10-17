import { useDraft, composeRequest } from '../../app/preferences'
import { DraftAttachments } from '../DraftAttachments'
import { useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FolderGit2, Send, Wrench } from 'lucide-react'
import { routeRequest, type AgentRunInfo, type Task } from '@hydra/protocol'
import { Button } from '../../design/components'
import { useApp, useAppState } from '../../app/context'
import { Markdown } from '../../lib/markdown'
import { FriendlyError } from '../../lib/explain'
import { ago, duration, money, tokens, statusLabel } from '../../lib/format'
import { DecisionBar } from './DecisionBar'
import { AgentsTab } from './AgentsTab'
import { ActivityTab } from './ActivityTab'
import { DEPTH_LABEL } from '../NewTaskForm'
import { useNow, useProviderName, useTaskRuns } from '../../ops/hooks'
import { DID, filesOf, shortTarget } from '../../ops/model'

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
  const engineVersion = useAppState(s => s.engineVersion)
  const tasks = useAppState((s) => s.tasks)
  const [details, setDetails] = useState(false)
  const unsent = useDraft(`follow:${task.id}`)
  const followUp = unsent.text
  const setFollowUp = (text: string) => unsent.set({ text })
  const submitting = useRef(false)
  const [submitError, setSubmitError] = useState('')
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
    if (submitting.current || !followUp.trim()) return
    let text: string
    try { text = composeRequest(followUp.trim(), unsent.attachments) } catch (e) { setSubmitError((e as Error).message); return }
    submitting.current = true
    const route = routeRequest(text)
    setBusy('follow')
    // A follow-up that asks for a change starts a change, with the conversation as context.
    const command = route.depth === 'deep' && project?.isGit
      ? { type: 'task.create', projectId: task.projectId, depth: 'deep', mode: 'safe', assignment: task.assignment,
          prompt: `${text}\n\n(Context from our conversation)\nQuestion: ${task.prompt}\nAnswer: ${(task.answer ?? '').slice(0, 3000)}` }
      : { type: 'task.create', projectId: task.projectId, prompt: text, depth: route.depth === 'deep' ? 'standard' : 'auto', followUpOf: task.id, mode: task.mode, assignment: task.assignment }
    const ack = await run(command)
    setBusy(null)
    submitting.current = false
    if (ack.ok) { unsent.set({ text: '', attachments: [] }); go({ view: 'task', taskId: (ack.result as Task).id }) }
  }

  const makeChange = async () => {
    setBusy('change')
    const ack = await run({ type: 'task.create', projectId: task.projectId, prompt: task.prompt, depth: 'deep', mode: 'safe', assignment: task.assignment })
    setBusy(null)
    if (ack.ok) go({ view: 'task', taskId: (ack.result as Task).id })
  }

  const turn = (t: Task, live: boolean) => (
    <article key={t.id} className="conversation-turn">
      <div className="chat__msg chat__msg--user">
        <div className="chat__who">You · {ago(t.createdAt)}</div>
        <div className="prose">{t.prompt}</div>
      </div>
      <div className="chat__msg">
        <div className="chat__who">
          {providerName(t.assignment.planner)}
          {t.answer && <span className="conversation-recorded">Recorded answer</span>}
          {t.route && <span className="chat__route" title={t.route.reason}>{DEPTH_LABEL[t.route.depth]}{t.route.auto ? ' · chosen by Hydra' : ''}</span>}
        </div>
        {live && thinking && <AnswerStatus task={t} runs={runs} />}
        {live && thinking && draft && <Markdown text={draft} />}
        {t.answer && !(live && thinking) && <Markdown text={t.answer} />}
        {live && !thinking && !t.answer && t.error && <FriendlyError message={t.error} status={t.status} />}
        {live && t.status === 'canceled' && <p className="muted">Stopped before answering.</p>}
        {live && !thinking && <LookedAt runs={runs} />}
      </div>
    </article>
  )

  return (
    <div className="conversation-workspace">
    <div className="repository-scope"><FolderGit2 size={17} aria-hidden /><div><strong>Selected project · {project?.name ?? 'Unavailable'}</strong><code>{project?.root ?? 'The selected project is unavailable.'}</code></div><span>Hydra runtime {engineVersion}</span></div>
    <section className="chat conversation-document" aria-label="Conversation">
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
      <div className="conversation-compose">
      {!thinking && (
        <div className="chat__reply">
          <textarea className="hx-textarea" rows={2} maxLength={50000} disabled={busy !== null} aria-label="Ask a follow-up" placeholder="Ask a follow-up…" value={followUp}
            onChange={(e) => setFollowUp(e.target.value)} onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === 'Enter' && !e.shiftKey && followUp.trim()) { e.preventDefault(); void ask() } }} />
          <Button variant="primary" icon={<Send size={14} />} busy={busy === 'follow'} disabled={!followUp.trim()} onClick={() => void ask()}>Send</Button>
        </div>
      )}
      {!thinking && <DraftAttachments files={unsent.attachments} onChange={attachments => unsent.set({ attachments })} disabled={busy !== null} />}
      {(unsent.error || submitError) && <p role="alert">{unsent.error || submitError}</p>}
      </div>
    </section>
    <aside className="conversation-inspector" aria-label="Execution and source context">
      <section><h2>This answer</h2><p className={`tone-${statusLabel(task).tone}`}>{statusLabel(task).label}</p><dl><dt>Agent</dt><dd>{providerName(task.assignment.planner)}</dd><dt>Recorded runs</dt><dd>{runs.length}</dd><dt>Access</dt><dd>Read-only question</dd></dl></section>
      <section><h2>Source context</h2><p>The agent inspects the selected project folder. That folder can differ from the source of the installed Hydra application.</p><dl><dt>Runtime at request</dt><dd>{task.sourceContext?.runtimeVersion ?? 'Not captured for this answer'}</dd></dl>{task.sourceContext && <code className="conversation-source-path">{task.sourceContext.projectRoot}</code>}{!task.sourceContext && <p className="faint">This saved answer predates source-context recording. Its original runtime identity is unknown.</p>}</section>
      {details && <section className="conversation-execution"><h2>Execution details</h2><AgentsTab runs={runs} /><h3>Recorded log</h3><ActivityTab task={task} /></section>}
    </aside>
    </div>
  )
}


/** While the answer is being written: who is working, on what, for how long. No spinner. */
function AnswerStatus({ task, runs }: { task: Task; runs: AgentRunInfo[] }) {
  const current = runs.filter((r) => r.status === 'running').at(-1)
  const last = useAppState((s) => (current ? s.activity[current.id]?.at(-1) : undefined))
  const now = useNow(true)
  const since = Date.parse(current?.startedAt ?? task.createdAt)
  const text = task.status === 'queued' ? 'Starting' : last ? `Working · last reported: ${DID[last.kind]} ${shortTarget(last.target, 64)}` : current ? 'Working' : 'Starting the agent'
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
