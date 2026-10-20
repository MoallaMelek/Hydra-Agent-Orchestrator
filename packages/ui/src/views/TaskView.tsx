import { useState } from 'react'
import { FileDiff, FlaskConical, List, ScrollText } from 'lucide-react'
import type { Task } from '@hydra/protocol'
import { Badge, EmptyState, Tabs } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { DecisionBar } from './task/DecisionBar'
import { OverviewTab } from './task/OverviewTab'
import { ChangesTab } from './task/ChangesTab'
import { ChecksTab } from './task/ChecksTab'
import { ActivityTab } from './task/ActivityTab'
import { ConversationView } from './task/ConversationView'
import { useTaskDiff } from './task/useTaskData'
import { approvalWarnings } from './task/warnings'
import { MODE_INFO, money, statusLabel, tokens } from '../lib/format'
import { useNow, useTaskEvidence, useTaskLoaded, useTaskRuns, useTrace } from '../ops/hooks'
import { OrchestrationCanvas } from '../ops/OrchestrationCanvas'
import { MissionReceipt } from './task/MissionReceipt'
import { revealInWorkspace } from '../lib/reveal'

type TabId = 'summary' | 'changes' | 'checks' | 'log'
export function TaskView({taskId}:{taskId:string}) {
  const {go}=useApp()
  const task=useAppState(s=>s.tasks[taskId])
  const project=useAppState(s=>task?s.projects.find(p=>p.id===task.projectId):undefined)
  useTaskLoaded(taskId)
  if(!task)return <div className="page"><EmptyState title="Task not found">It may have been deleted.</EmptyState></div>
  return <div className={`page page--wide task-page ${task.intent==='analyze'?'task-page--conversation':''}`}><nav className="crumbs" aria-label="Breadcrumbs"><button onClick={()=>go({view:'home'})}>Mission control</button><span>/</span>{project&&<><button onClick={()=>go({view:'project',projectId:project.id})}>{project.name}</button><span>/</span></>}<span className="truncate" title={task.title}>{task.intent==='change'?'Engineering mission':'Conversation'}</span></nav>{task.intent==='analyze'?<ConversationView task={task}/>:<ChangeView task={task}/>}</div>
}
function ChangeView({task}:{task:Task}) {
  const runs=useTaskRuns(task.id), evidence=useTaskEvidence(task.id)
  const live=task.status==='running'||task.status==='queued'
  const now=useNow(live)
  const trace=useTrace(task.id,now)
  const [tab,setTab]=useState<TabId>('summary')
  const [detailsOpen,setDetailsOpen]=useState(false)
  const hasWorkspace=Boolean(task.workspace&&!task.workspace.removed)
  const {diff,error:diffError}=useTaskDiff(task.id,task.workspace?.headSha,hasWorkspace&&(tab==='changes'||task.status==='waiting_input'))
  const warnings=approvalWarnings(task,evidence,diff)
  const status=statusLabel(task)
  const inspect=(target:TabId)=>{setTab(target);setDetailsOpen(true);requestAnimationFrame(()=>revealInWorkspace(document.getElementById('task-inspector')))}
  return <>
    <header className="task-head mission-head"><div className="task-head__title"><h1>{task.title}</h1><div className="row"><Badge tone={status.tone}>{status.label}</Badge><span className="muted">{MODE_INFO[task.mode].label} · {task.fixRound>0?`${task.fixRound} repair round${task.fixRound===1?'':'s'}`:'Isolated engineering workflow'}</span></div></div><dl className="task-head__stats num"><div><dt>Reported cost</dt><dd>{money(task.usage.costUsd)}{task.usage.unpricedTokens>0&&<small> + unpriced</small>}</dd></div><div><dt>Reported tokens</dt><dd title="Includes cached input; reporting may arrive late">{tokens(task.usage.inputTokens+task.usage.outputTokens+task.usage.cachedTokens)}</dd></div></dl></header>
    {trace?<OrchestrationCanvas task={task} trace={trace} runs={runs} evidence={evidence} onInspect={inspect} controls={task.status==='waiting_input'?<DecisionBar task={task} blockingWarnings={warnings.filter(w=>w.tone==='bad').length}/>:undefined}/>:<p role="status">Loading recorded operations…</p>}
    {task.status!=='waiting_input'&&<div className="mission-action" aria-label="Mission controls"><DecisionBar task={task} blockingWarnings={warnings.filter(w=>w.tone==='bad').length}/></div>}
    <details className="disclosure mission-dossier" open={detailsOpen} onToggle={e => setDetailsOpen(e.currentTarget.open)}>
      <summary>Mission details <span>Plan, revision diff, check evidence and delivery receipt</span></summary>
      <div className="task-grid">
        <section className="hx-panel task-grid__main" id="task-inspector" tabIndex={-1} aria-label="Inspect recorded work">
          <Tabs<TabId> value={tab} onChange={setTab} tabs={[
            { id: 'summary', label: 'Summary', icon: <ScrollText size={14} /> },
            { id: 'changes', label: 'Changes', icon: <FileDiff size={14} />, count: diff?.files.length },
            { id: 'checks', label: 'Checks', icon: <FlaskConical size={14} />, count: evidence.length },
            { id: 'log', label: 'Log', icon: <List size={14} /> }
          ]} />
          <div className="hx-panel__body">
            {tab === 'summary' && <><OverviewTab task={task} warnings={warnings} /><MissionReceipt task={task} evidence={evidence} /></>}
            {tab === 'changes' && <ChangesTab diff={diff} error={diffError} removed={!hasWorkspace} />}
            {tab === 'checks' && <ChecksTab task={task} evidence={evidence} />}
            {tab === 'log' && <ActivityTab task={task} />}
          </div>
        </section>
      </div>
    </details>
  </>
}
