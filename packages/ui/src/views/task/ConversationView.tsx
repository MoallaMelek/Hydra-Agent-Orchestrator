import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Task } from '@hydra/protocol'
import { Callout } from '../../design/components'
import { useApp } from '../../app/context'
import { Markdown } from '../../lib/markdown'
import { ago, money, tokens } from '../../lib/format'
import { DecisionBar } from './DecisionBar'
import { AgentsTab } from './AgentsTab'
import { ActivityTab } from './ActivityTab'
import type { useTaskDetail } from './useTaskData'

/** A question and its answer, shown as a conversation rather than a pipeline. */
export function ConversationView({ task, detail }: { task: Task; detail: ReturnType<typeof useTaskDetail> }) {
  const { state } = useApp()
  const [details, setDetails] = useState(false)
  const who = state.providers.find((p) => p.id === task.assignment.planner)?.displayName ?? task.assignment.planner
  const thinking = task.status === 'running' || task.status === 'queued'
  const used = task.usage.inputTokens + task.usage.outputTokens

  return (
    <section className="hx-panel chat">
      <div className="chat__msg chat__msg--user">
        <div className="chat__who">You · {ago(task.createdAt)}</div>
        <div className="prose">{task.prompt}</div>
      </div>
      <div className="chat__msg">
        <div className="chat__who">Hydra · {who}</div>
        {thinking && <p className="muted row"><span className="hx-spinner" aria-hidden /> Reading the code…</p>}
        {task.answer && <Markdown text={task.answer} />}
        {!thinking && !task.answer && task.error && <Callout tone={task.status === 'paused' ? 'warn' : 'bad'}>{task.error}</Callout>}
        {task.status === 'canceled' && <p className="muted">Stopped before answering.</p>}
      </div>
      <div className="chat__foot">
        <span className="faint">{used ? `${money(task.usage.costUsd)} · ${tokens(used)} tokens` : ''}</span>
        <div className="row">
          <button type="button" className="chat__toggle" aria-expanded={details} onClick={() => setDetails(!details)}>
            {details ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Details
          </button>
          <DecisionBar task={task} blockingWarnings={0} />
        </div>
      </div>
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
