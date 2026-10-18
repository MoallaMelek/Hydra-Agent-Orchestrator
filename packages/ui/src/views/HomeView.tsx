import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, FlaskConical, GitBranch, Plus, ShieldCheck } from 'lucide-react'
import type { AgentRunInfo, Task } from '@hydra/protocol'
import { HydraMark } from '../brand/HydraMark'
import { Badge, Button, Callout } from '../design/components'
import { shallow } from '../api/store'
import { useApp, useAppState } from '../app/context'
import { providerReady, SetupChecklist } from './SetupChecklist'
import { ago, duration, statusLabel } from '../lib/format'
import { RelayTrace } from '../ops/RelayTrace'
import { useNow, useProviderName, useSlots, useTrace, useTaskLoaded, useTaskRuns } from '../ops/hooks'
import { DID, shortTarget } from '../ops/model'
import { Markdown } from '../lib/markdown'
import { NewTaskForm } from './NewTaskForm'

const ROLE = { planner: 'Planning', implementer: 'Implementing', reviewer: 'Reviewing' } as const
const AGENT_STAGES = new Set(['plan', 'implement', 'fix', 'review'])

export function HomeView({ onAddProject }: { onAddProject: () => void }) {
  const { go, store, isRemote } = useApp()
  const hasProjects = useAppState((s) => s.projects.length > 0)
  const ready = useAppState((s) => s.ready)
  const anyReady = useAppState((s) => s.providers.some(providerReady))
  const noProviders = useAppState((s) => s.providers.length === 0)
  const connected = useAppState((s) => s.connection === 'live')
  const tasks = useAppState((s) => Object.values(s.tasks).filter((t) => !t.archivedAt), shallow)
  const projectName = useAppState((s) => s.projects)
  const nameOf = (id: string) => projectName.find((p) => p.id === id)?.name ?? 'Unknown project'
  const onlyProject = projectName.length === 1 ? projectName[0] : undefined
  const slots = useSlots()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composeProject, setComposeProject] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [allDecisions, setAllDecisions] = useState(false)
  const writingIn = projectName.find(p => p.id === composeProject) ?? onlyProject ?? projectName[0]

  const sorted = useMemo(() => [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [tasks])
  const needsYou = sorted.filter((t) => t.status === 'waiting_input')
  const active = sorted.filter((t) => t.status === 'running' || t.status === 'queued')
  const recent = sorted.filter((t) => t.status !== 'running' && t.status !== 'queued' && t.status !== 'waiting_input').slice(0, 10)
  const candidates = [...needsYou, ...active, ...recent].slice(0, 8)
  const focused = candidates.find(t => t.id === selectedId) ?? candidates[0]
  const runningTaskIds = new Set(slots.runs.map((r) => r.taskId))
  // Inferred: an active task in an agent stage with no running agent while every slot is busy.
  const waitingForSlot = slots.busy >= slots.limit ? active.filter((t) => AGENT_STAGES.has(t.stage) && !runningTaskIds.has(t.id)) : []

  // Compact traces need each active task's runs and checks.
  const activeIds = active.map((t) => t.id).join(',')
  useEffect(() => { if (detailsOpen) for (const id of activeIds.split(',').filter(Boolean).slice(0, 12)) void store.loadTask(id) }, [activeIds, detailsOpen, store])

  if (!ready) return <div className="page" aria-busy="true"><h1>Workspace</h1><p role="status" className="muted">Loading your workspace…</p></div>

  if (!hasProjects && isRemote) return <div className="page page--narrow"><h1>Your desktop has no projects yet</h1><p className="muted">Add a project in Hydra on your computer. Its tasks and recorded work will then be available here.</p></div>

  if (!hasProjects) {
    return (
      <div className="page page--narrow onboarding">
        <div className="onboarding__hero">
          <HydraMark size={52} />
          <h1>Your idea.<br />A change you can inspect.</h1>
          <p className="muted">Talk through a project with your own AI accounts. When you ask for a change, Hydra coordinates the work in an isolated copy, records the checks, and brings the decision back to you.</p>
        </div>
        <SetupChecklist onAddProject={onAddProject} />
        <ul className="onboarding__facts">
          <li><GitBranch size={16} aria-hidden /> An isolated worktree for every task</li>
          <li><FlaskConical size={16} aria-hidden /> Tests run by Hydra, not claimed by agents</li>
          <li><ShieldCheck size={16} aria-hidden /> Nothing reaches your branch without you</li>
        </ul>
      </div>
    )
  }

  return (
    <div className="page operations-home">
      <header className="page__head operations-home__head">
        <div className="page__title">
          <h1>What shall we work on?</h1>
          <p className="muted num">
            {slots.busy ? `${slots.busy} agent${slots.busy === 1 ? '' : 's'} working` : 'Ready for your next idea'}{needsYou.length ? ` · ${needsYou.length} loaded task${needsYou.length === 1 ? '' : 's'} waiting for you` : ''}
          </p>
        </div>
        <Button icon={<Plus size={15} />} onClick={onAddProject}>Add project</Button>
      </header>
      {!noProviders && !anyReady && (
        <Callout tone="warn">
          No agent is ready, so new tasks cannot run. Install Claude Code or Codex and sign in with your own account.{' '}
          <Button size="sm" variant="ghost" onClick={() => go({ view: 'providers' })}>Open AI accounts</Button>
        </Callout>
      )}

      {needsYou.length > 0 && (
        <section className="needs-you" aria-label="Waiting for your decision">
          <h2 className="section-title">Waiting for you</h2>
          {(allDecisions ? needsYou : needsYou.slice(0, 3)).map((t) => (
            <button key={t.id} className="needs-you__row" onClick={() => go({ view: 'task', taskId: t.id })}>
              <span className="needs-you__what">{t.waitReason === 'plan_approval' ? 'Approve the plan' : t.waitReason === 'final_approval' ? 'Review the result' : 'Decide'}</span>
              <span className="grow truncate"><b>{t.title}</b> <span className="faint">· {nameOf(t.projectId)}</span></span>
              <span className="faint">{ago(t.updatedAt)}</span>
              <ArrowRight size={15} aria-hidden />
            </button>
          ))}
          {needsYou.length > 3 && <Button size="sm" variant="ghost" onClick={() => setAllDecisions(!allDecisions)}>{allDecisions ? 'Show fewer decisions' : `Show all ${needsYou.length} loaded decisions`}</Button>}
        </section>
      )}

      {writingIn && <section className="request-sheet" aria-label="Start a conversation">
        <div className="request-sheet__project"><label htmlFor="workspace-project">Working in</label><select id="workspace-project" className="hx-select" value={writingIn.id} onChange={e => setComposeProject(e.target.value)}>{projectName.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="faint truncate" title={writingIn.root}>{writingIn.root}</span></div>
        <NewTaskForm key={writingIn.id} projectId={writingIn.id} isGit={writingIn.isGit} />
      </section>}
      {active.length > 0 && <section className="workroom-active" aria-label="Current work"><h2 className="section-title">Work underway</h2>{active.slice(0, 3).map(t => <button key={t.id} onClick={() => go({ view: 'task', taskId: t.id })}><span><b>{t.title}</b><small>{nameOf(t.projectId)}</small></span><span>{statusLabel(t).label} · {t.stage === 'verify' ? 'Running project checks' : t.stage === 'apply' ? 'Applying accepted revision' : runningTaskIds.has(t.id) ? 'Agent process running' : 'Waiting on engine'}</span><ArrowRight size={16} aria-hidden /></button>)}</section>}

      <details className="disclosure" onToggle={e => setDetailsOpen(e.currentTarget.open)}><summary>Work details <span>Recorded operations, agents and project workspaces</span></summary>{detailsOpen && <><div className="operations-desk">
        <section className="focus-desk" aria-label="Work in focus">
          <div className="focus-desk__head"><h2>Work in focus</h2><span className="faint">{!connected ? 'Saved snapshot · connection unavailable' : slots.busy > 0 ? 'Live and recorded work' : 'Recorded work · no agents running'}</span></div>
          {focused ? <FocusOperation key={focused.id} task={focused} project={nameOf(focused.projectId)} /> : <div className="focus-desk__empty"><HydraMark size={56} /><h3>Your first task starts here.</h3><p>Open a project to ask a question or describe a change. Agent work and verified results will appear here as they are recorded.</p></div>}
          {candidates.length > 1 && <div className="focus-switcher" aria-label="Choose work to inspect">{candidates.map(task => <button key={task.id} aria-pressed={task.id === focused?.id} onClick={() => setSelectedId(task.id)}><span className={`focus-switcher__state tone-${statusLabel(task).tone}`}>{statusLabel(task).label}</span><span className="truncate">{task.title}</span></button>)}</div>}
        </section>
        <aside className="project-desk" id="home-projects" tabIndex={-1} aria-label="Project workspaces">
          <h2>Where shall we work?</h2><p className="muted">Choose a repository to start a task or return to a conversation.</p>
          <div className="project-desk__list">{projectName.map(project => <button key={project.id} onClick={() => go({ view: 'project', projectId: project.id })}><GitBranch size={18} aria-hidden /><span><strong>{project.name}</strong><small className="mono truncate" title={project.root}>{project.root}</small></span><ArrowRight size={15} aria-hidden /></button>)}</div>
          {!isRemote && <Button variant="ghost" icon={<Plus size={14} />} onClick={onAddProject}>Add another project</Button>}
          <div className="project-desk__safety"><ShieldCheck size={19} aria-hidden /><p>Changes stay in an isolated worktree. Your branch changes only after you accept the result.</p></div>
        </aside>
      </div>

      {slots.busy > 0 && <section className="capacity-desk" aria-label="Agent slots">
        <h2 className="section-title">Agents at work <span className="faint num">{slots.busy}/{slots.limit}</span></h2>
        <p className="faint section-note">Hydra runs at most {slots.limit} agent processes at once, across all tasks. Inside one task, agents take turns.</p>
        <SlotBoard runs={slots.runs} limit={slots.limit} tasks={tasks} />
        {waitingForSlot.length > 0 && (
          <p className="slot-queue">Waiting for a free slot (inferred): {waitingForSlot.map((t) => <button key={t.id} className="link-btn" onClick={() => go({ view: 'task', taskId: t.id })}>{t.title}</button>)}</p>
        )}
      </section>}

      {active.length > 0 && (
        <section aria-label="Tasks in progress">
          <h2 className="section-title">In progress</h2>
          <div className="task-rows">{active.map((t) => <ActiveRow key={t.id} task={t} project={nameOf(t.projectId)} />)}</div>
        </section>
      )}
      </>}</details>

      <section aria-label="Recent tasks">
        <h2 className="section-title">Recent</h2>
        <p className="faint section-note">This workspace shows loaded recent work. Open a project’s History to search or page through every saved task.</p>
        {recent.length ? (
          <div className="task-rows">{recent.map((t) => <RecentRow key={t.id} task={t} project={nameOf(t.projectId)} />)}</div>
        ) : <p className="muted">No finished tasks yet. Open a project to ask a question or describe a change.</p>}
      </section>
    </div>
  )
}

/** A genuine saved task, including on an idle installation; never a fabricated live demo. */
function FocusOperation({ task, project }: { task: Task; project: string }) {
  const { go } = useApp()
  const loaded = useTaskLoaded(task.id)
  const detailUnavailable = useAppState(s => !s.loaded[task.id] && Boolean(s.error))
  const runs = useTaskRuns(task.id)
  const name = useProviderName()
  const live = task.status === 'running' || task.status === 'queued'
  const now = useNow(live)
  const trace = useTrace(task.id, now)
  const status = statusLabel(task)
  return <div className="focus-operation">
    <div className="focus-operation__meta"><Badge tone={status.tone}>{status.label}</Badge><span>{project}</span><span>{ago(task.updatedAt)}</span></div>
    <h3>{task.title}</h3>
    {task.prompt !== task.title && <p className="focus-operation__request">{task.prompt.slice(0, 500)}{task.prompt.length > 500 ? '…' : ''}</p>}
    {task.intent === 'analyze' ? <>
      <div className="focus-operation__actors">{runs.map(run => <span key={run.id}><span className={`actor-dot actor-dot--${run.status}`} aria-hidden /><b>{name(run.provider)}</b><span>{run.status === 'running' ? 'Running' : run.status === 'succeeded' ? 'Execution finished' : run.status}</span></span>)}{!loaded && <span>Loading recorded agents…</span>}</div>
      <div className="focus-answer"><h4>{task.answer ? 'Recorded answer · preview' : live ? 'Answer in progress' : 'No answer recorded'}</h4>{task.answer ? <Markdown text={task.answer.slice(0, 1500) + (task.answer.length > 1500 ? '…' : '')} /> : <p>{live ? 'Open the task to inspect reported activity. No final answer has been recorded yet.' : 'Open the task to inspect its status and available evidence.'}</p>}</div>
    </> : loaded && trace ? <div className="focus-team" aria-label="Team operations">{trace.lanes.filter(lane => lane.id !== 'you').map(lane => {
      const operations = trace.segments.filter(segment => segment.lane === lane.id)
      const latest = operations.at(-1)
      return <div className="focus-team__row" key={lane.id}><span><strong>{lane.title}</strong><small>{lane.actor}</small></span><span>{latest?.label ?? 'No recorded operation'}</span><span className={`focus-team__status tone-${latest?.status === 'running' ? 'accent' : latest?.status === 'failed' || latest?.status === 'interrupted' ? 'bad' : 'neutral'}`}>{!latest ? 'No record' : latest.status === 'running' ? 'Running' : latest.status === 'ok' ? 'Execution finished' : latest.status}{latest?.basis === 'inferred' ? ' · inferred' : ''}</span></div>
    })}</div> : <p className="muted">{detailUnavailable ? 'Operation details are unavailable. Open the task to retry loading them.' : 'Loading recorded operations…'}</p>}
    <Button icon={<ArrowRight size={15} />} onClick={() => go({ view: 'task', taskId: task.id })}>{task.intent === 'analyze' ? 'Open conversation' : 'Open task workspace'}</Button>
  </div>
}

/** One cell per engine slot: free, or which agent holds it, for which task, doing what. */
function SlotBoard({ runs, limit, tasks }: { runs: AgentRunInfo[]; limit: number; tasks: Task[] }) {
  const cells = Array.from({ length: Math.max(limit, runs.length) }, (_, i) => runs[i] ?? null)
  return <ol className="slots">{cells.map((run, i) => <li key={run?.id ?? `free-${i}`}>{run ? <SlotCell run={run} task={tasks.find((t) => t.id === run.taskId)} /> : <span className="slot slot--free">Free</span>}</li>)}</ol>
}

function SlotCell({ run, task }: { run: AgentRunInfo; task: Task | undefined }) {
  const { go } = useApp()
  const name = useProviderName()
  const last = useAppState((s) => s.activity[run.id]?.at(-1))
  const now = useNow(true)
  return (
    <button className="slot slot--busy" onClick={() => task && go({ view: 'task', taskId: task.id })}>
      <span className="slot__who"><b>{name(run.provider)}</b> <span className="faint">· {ROLE[run.role]}{run.stage === 'fix' ? ' (repair)' : ''}</span></span>
      <span className="slot__task truncate">{task?.title ?? 'Task'}</span>
      <span className="slot__doing truncate mono">{last ? `Last: ${DID[last.kind]} ${shortTarget(last.target, 44)}` : now - Date.parse(run.startedAt) > 3000 ? 'Working · no tool call reported yet' : 'Starting…'}</span>
      <span className="slot__time faint num">{duration(Math.max(0, now - Date.parse(run.startedAt)))}</span>
    </button>
  )
}

function ActiveRow({ task, project }: { task: Task; project: string }) {
  const { go } = useApp()
  const now = useNow(true)
  const trace = useTrace(task.id, now)
  const s = statusLabel(task)
  return (
    // A container, not a button: the compact trace is block content. The title is the control.
    <div className="task-row task-row--active" onClick={() => go({ view: 'task', taskId: task.id })}>
      <span className="task-row__main">
        <button type="button" className="task-row__title task-row__link truncate" onClick={(e) => { e.stopPropagation(); go({ view: 'task', taskId: task.id }) }}>{task.title}</button>
        <span className={`task-row__now truncate tone-${trace?.headline.tone ?? 'neutral'}`}>{trace?.headline.text ?? s.label}{trace?.headline.basis === 'inferred' && <span className="faint"> · inferred</span>}{trace?.headline.last && <span className="faint"> · last: {trace.headline.last.text}</span>}</span>
      </span>
      <div className="task-row__trace">{trace && <RelayTrace trace={trace} selection={null} onSelect={() => {}} compact />}</div>
      <span className="task-row__meta"><Badge tone={s.tone} live={s.live}>{s.label}</Badge><span className="faint">{project}</span></span>
    </div>
  )
}

function RecentRow({ task, project }: { task: Task; project: string }) {
  const { go } = useApp()
  const s = statusLabel(task)
  return (
    <button className="task-row" onClick={() => go({ view: 'task', taskId: task.id })}>
      <span className="task-row__main">
        <span className="task-row__title truncate">{task.title}</span>
        <span className="task-row__now faint truncate">{task.intent === 'analyze' ? 'Question' : `Change · ${task.mode}`} · {project} · {ago(task.updatedAt)}</span>
      </span>
      <span className="task-row__meta"><Badge tone={s.tone}>{s.label}</Badge></span>
    </button>
  )
}
