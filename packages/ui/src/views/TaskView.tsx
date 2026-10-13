import { useState } from 'react'
import { Activity, Bot, FileDiff, FlaskConical, LayoutList } from 'lucide-react'
import { Badge, EmptyState, Meter, Tabs } from '../design/components'
import { useApp } from '../app/context'
import { StagePipeline } from './StagePipeline'
import { DecisionBar } from './task/DecisionBar'
import { OverviewTab } from './task/OverviewTab'
import { ChangesTab } from './task/ChangesTab'
import { ChecksTab } from './task/ChecksTab'
import { AgentsTab } from './task/AgentsTab'
import { ActivityTab } from './task/ActivityTab'
import { ConversationView } from './task/ConversationView'
import { useTaskDetail, useTaskDiff } from './task/useTaskData'
import { approvalWarnings } from './task/warnings'
import { MODE_INFO, money, shortSha, statusLabel, tokens } from '../lib/format'

type TabId = 'overview' | 'changes' | 'checks' | 'agents' | 'activity'

export function TaskView({ taskId }: { taskId: string }) {
  const { state, go } = useApp()
  const task = state.tasks[taskId]
  const [tab, setTab] = useState<TabId>('overview')
  const detail = useTaskDetail(taskId)
  const hasWorkspace = Boolean(task?.workspace && !task.workspace.removed)
  const { diff, error: diffError } = useTaskDiff(taskId, task?.workspace?.headSha, hasWorkspace && task?.intent === 'change')
  if (!task) return <div className="page"><EmptyState title="Task not found">It may have been deleted.</EmptyState></div>

  const project = state.projects.find((p) => p.id === task.projectId)
  const evidence = detail?.evidence ?? []
  const runs = detail?.runs ?? []
  const warnings = task.intent === 'change' ? approvalWarnings(task, evidence, diff) : []
  const status = statusLabel(task)
  const tokenTotal = task.usage.inputTokens + task.usage.outputTokens

  return (
    <div className="page">
      <div className="crumbs">
        <button onClick={() => go({ view: 'home' })}>Overview</button><span>/</span>
        {project && <><button onClick={() => go({ view: 'project', projectId: project.id })}>{project.name}</button><span>/</span></>}
        <span className="truncate" style={{ maxWidth: 360 }} title={task.title}>{task.title}</span>
      </div>
      {task.intent === 'analyze' ? <ConversationView task={task} detail={detail} /> : (
      <section className="hx-panel">
        <div className="task-head">
          <div className="page__head">
            <div className="page__title">
              <h2 style={{ fontSize: 20 }}>{task.title}</h2>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <Badge tone={status.tone} live={status.live}>{status.label}</Badge>
                {task.intent === 'change' && <Badge tone="neutral" plain title={MODE_INFO[task.mode].detail}>{MODE_INFO[task.mode].label} mode</Badge>}
                {task.workspace && <span className="faint mono" style={{ fontSize: 12 }}>{task.workspace.branch} · {shortSha(task.workspace.baseSha)} → {shortSha(task.workspace.headSha)}</span>}
              </div>
            </div>
            <div className="stats">
              <div className="stat"><span className="stat__value">{money(task.usage.costUsd)}</span><span className="stat__label">cost (limit {money(task.budget.maxCostUsd)})</span></div>
              <div className="stat"><span className="stat__value">{tokens(tokenTotal)}</span><span className="stat__label">tokens{task.usage.unpricedTokens ? ` (${tokens(task.usage.unpricedTokens)} unpriced)` : ''}</span></div>
              <div className="stat"><span className="stat__value">{task.usage.agentRuns}</span><span className="stat__label">agent runs (limit {task.budget.maxAgentRuns})</span></div>
            </div>
          </div>
          <Meter value={Math.max(task.usage.costUsd / task.budget.maxCostUsd, tokenTotal / task.budget.maxTokens) * 100} max={100} label="Budget used" />
          <StagePipeline task={task} />
          <DecisionBar task={task} blockingWarnings={warnings.filter((w) => w.tone === 'bad').length} />
        </div>
        <Tabs<TabId> value={tab} onChange={setTab} tabs={[
          { id: 'overview', label: 'Overview', icon: <LayoutList size={14} /> },
          ...(task.intent === 'change' ? [
            { id: 'changes' as const, label: 'Changes', icon: <FileDiff size={14} />, count: diff?.files.length },
            { id: 'checks' as const, label: 'Checks', icon: <FlaskConical size={14} />, count: evidence.length }
          ] : []),
          { id: 'agents', label: 'Agents', icon: <Bot size={14} />, count: runs.length },
          { id: 'activity', label: 'Activity', icon: <Activity size={14} /> }
        ]} />
        <div className="hx-panel__body">
          {tab === 'overview' && <OverviewTab task={task} warnings={warnings} />}
          {tab === 'changes' && <ChangesTab diff={diff} error={diffError} removed={!hasWorkspace} />}
          {tab === 'checks' && <ChecksTab task={task} evidence={evidence} />}
          {tab === 'agents' && <AgentsTab runs={runs} />}
          {tab === 'activity' && <ActivityTab task={task} />}
        </div>
      </section>
      )}
    </div>
  )
}
