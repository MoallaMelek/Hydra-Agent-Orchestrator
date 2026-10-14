import { useState } from 'react'
import { ChevronDown, ChevronRight, Send, Wrench } from 'lucide-react'
import { routeRequest, type Task } from '@hydra/protocol'
import { Button } from '../../design/components'
import { useApp } from '../../app/context'
import { Markdown } from '../../lib/markdown'
import { FriendlyError } from '../../lib/explain'
import { ago, money, tokens } from '../../lib/format'
import { DecisionBar } from './DecisionBar'
import { AgentsTab } from './AgentsTab'
import { ActivityTab } from './ActivityTab'
import { DEPTH_LABEL } from '../NewTaskForm'
import type { useTaskDetail } from './useTaskData'

/** A question and its answer, shown as a conversation rather than a pipeline. */
export function ConversationView({ task, detail }: { task: Task; detail: ReturnType<typeof useTaskDetail> }) {
  const { state, run, go } = useApp()
  const [details, setDetails] = useState(false)
  const [followUp, setFollowUp] = useState('')
  const [busy, setBusy] = useState<'follow' | 'change' | null>(null)
  const who = (t: Task) => state.providers.find((p) => p.id === t.assignment.planner)?.displayName ?? t.assignment.planner
  const thinking = task.status === 'running' || task.status === 'queued'
  const draft = state.drafts[task.id]
  // What the agent is doing right now, from its latest tool call ("› Read src/app.ts").
  const runId = detail?.runs.at(-1)?.id
  const lastTool = runId ? (state.output[runId] ?? '').trimEnd().split('\n').reverse().find((line) => line.startsWith('› ')) : undefined
  const activity = lastTool ? describeTool(lastTool.slice(2)) : null
  const used = task.usage.inputTokens + task.usage.outputTokens
  const project = state.projects.find((p) => p.id === task.projectId)

  // Earlier turns of this conversation, oldest first.
  const earlier: Task[] = []
  for (let id = task.followUpOf; id && earlier.length < 10;) {
    const previous: Task | undefined = state.tasks[id]
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
          Hydra · {who(t)}
          {t.route && <span className="chat__route" title={t.route.reason}>{DEPTH_LABEL[t.route.depth]}{t.route.auto ? ' (auto)' : ''}</span>}
        </div>
        {live && thinking && !draft && <p className="muted row"><span className="hx-spinner" aria-hidden /> {t.status === 'queued' ? 'Starting…' : activity ?? 'Thinking…'}</p>}
        {live && thinking && draft && <Markdown text={draft} />}
        {t.answer && !(live && thinking) && <Markdown text={t.answer} />}
        {live && !thinking && !t.answer && t.error && <FriendlyError message={t.error} status={t.status} />}
        {live && t.status === 'canceled' && <p className="muted">Stopped before answering.</p>}
      </div>
    </div>
  )

  return (
    <section className="hx-panel chat">
      {earlier.map((t) => turn(t, false))}
      {turn(task, true)}
      <div className="chat__foot">
        <span className="faint">
          {!thinking && `${((Date.parse(task.updatedAt) - Date.parse(task.createdAt)) / 1000).toFixed(1)} s`}
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
          <AgentsTab runs={detail?.runs ?? []} />
          <h4>Activity</h4>
          <ActivityTab task={task} />
        </div>
      )}
    </section>
  )
}

/** "Read src/app.ts" → "Reading src/app.ts…" */
function describeTool(line: string): string {
  const [name = '', ...rest] = line.split(' ')
  const target = rest.join(' ').trim()
  const verb: Record<string, string> = { Read: 'Reading', Glob: 'Looking for files', Grep: 'Searching for', shell: 'Running', edit: 'Editing' }
  return `${verb[name] ?? 'Working'}${target ? ` ${target.length > 80 ? `…${target.slice(-80)}` : target}` : ''}…`
}
