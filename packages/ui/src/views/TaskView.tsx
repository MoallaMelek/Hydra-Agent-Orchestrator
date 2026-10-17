import { useEffect, useMemo, useState } from 'react'
import { FileDiff, FlaskConical, List, Pause, Play, Rewind, ScrollText, Waypoints } from 'lucide-react'
import type { Task } from '@hydra/protocol'
import { Badge, Button, EmptyState, Segmented, Tabs } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { DecisionBar } from './task/DecisionBar'
import { OverviewTab } from './task/OverviewTab'
import { ChangesTab } from './task/ChangesTab'
import { ChecksTab } from './task/ChecksTab'
import { ActivityTab } from './task/ActivityTab'
import { ConversationView } from './task/ConversationView'
import { useTaskDiff } from './task/useTaskData'
import { approvalWarnings } from './task/warnings'
import { MODE_INFO, money, statusLabel, tokens, duration } from '../lib/format'
import { RelayTrace, type Selection } from '../ops/RelayTrace'
import { Inspector } from '../ops/Inspector'
import { TraceList } from '../ops/TraceList'
import { useNow, useTaskEvidence, useTaskLoaded, useTaskRuns, useTrace } from '../ops/hooks'
import type { Trace } from '../ops/model'
import { Workflow, ArtifactPath } from '../ops/Workflow'

type TabId = 'summary' | 'changes' | 'checks' | 'log'

export function TaskView({ taskId }: { taskId: string }) {
  const { go } = useApp()
  const task = useAppState((s) => s.tasks[taskId])
  const project = useAppState((s) => (task ? s.projects.find((p) => p.id === task.projectId) : undefined))
  useTaskLoaded(taskId)
  if (!task) return <div className="page"><EmptyState title="Task not found">It may have been deleted.</EmptyState></div>
  return (
    <div className={`page page--wide task-page ${task.intent === 'analyze' ? 'task-page--conversation' : ''}`}>
      <nav className="crumbs" aria-label="Breadcrumbs">
        <button onClick={() => go({ view: 'home' })}>Command center</button><span>/</span>
        {project && <><button onClick={() => go({ view: 'project', projectId: project.id })}>{project.name}</button><span>/</span></>}
        <span className="truncate" style={{ maxWidth: 420 }} title={task.title}>{task.title}</span>
      </nav>
      {task.intent === 'analyze' ? <ConversationView task={task} /> : <ChangeView task={task} />}
    </div>
  )
}

function ChangeView({ task }: { task: Task }) {
  const [visual, setVisual] = useState<'workflow' | 'timeline' | 'artifacts'>('workflow')
  const runs = useTaskRuns(task.id)
  const evidence = useTaskEvidence(task.id)
  const live = task.status === 'running' || task.status === 'queued' || task.status === 'waiting_input'
  const [tab, setTab] = useState<TabId>('summary')
  // On a phone the chronological list reads better than a wide diagram (both stay available).
  const [listView, setListView] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches)

  // Freeze: the drawing holds still (execution is unaffected); updates are counted until resumed.
  const [frozen, setFrozen] = useState<Trace | null>(null)
  const [missed, setMissed] = useState(0)
  const now = useNow(live && !frozen)
  const current = useTrace(task.id, now)
  useEffect(() => { if (frozen && current) setMissed((n) => n + 1) }, [current])
  const shown = frozen ?? current

  // Replay: scrub or play through the task as it happened.
  const [cursor, setCursor] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing || !shown) return
    const step = Math.max(250, (shown.end - shown.start) / 150)
    const timer = setInterval(() => setCursor((c) => {
      const next = (c ?? shown.start) + step
      if (next >= (shown.live ? shown.now : shown.end)) { setPlaying(false); return null }
      return next
    }), 100)
    return () => clearInterval(timer)
  }, [playing, shown])

  const [selection, setSelection] = useState<Selection>(null)
  const auto = useMemo(() => (shown ? defaultSelection(shown) : null), [shown])
  const active = selection ?? auto

  const hasWorkspace = Boolean(task.workspace && !task.workspace.removed)
  const { diff, error: diffError } = useTaskDiff(task.id, task.workspace?.headSha, hasWorkspace && (tab === 'changes' || task.status === 'waiting_input'))
  const warnings = approvalWarnings(task, evidence, diff)
  const status = statusLabel(task)
  const used = task.usage.inputTokens + task.usage.outputTokens
  // Never behind the last real update (the shared clock pauses while the window is hidden).
  const elapsed = (live ? Math.max(now, Date.parse(task.updatedAt)) : Date.parse(task.updatedAt)) - Date.parse(task.createdAt)
  const headline = shown?.headline

  return (
    <>
      <header className="task-head">
        <div className="task-head__title">
          <h1>{task.title}</h1>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <Badge tone={status.tone} live={status.live}>{status.label}</Badge>
            <Badge tone="neutral" plain title={MODE_INFO[task.mode].detail}>{MODE_INFO[task.mode].label} mode</Badge>
            {task.route?.risk === 'high' && <Badge tone="warn" title={task.route.reason}>High risk · plan approval required</Badge>}
            {task.fixRound > 0 && <Badge tone="neutral" plain>{task.fixRound} repair round{task.fixRound === 1 ? '' : 's'}</Badge>}
          </div>
        </div>
        <dl className="task-head__stats num">
          <div><dt>Time</dt><dd>{duration(Math.max(0, elapsed))}</dd></div>
          <div><dt>Cost</dt><dd>{money(task.usage.costUsd)}<span className="faint"> / {money(task.budget.maxCostUsd)}</span></dd></div>
          <div><dt>Tokens</dt><dd>{tokens(used)}</dd></div>
          <div><dt>Agent runs</dt><dd>{task.usage.agentRuns}<span className="faint"> / {task.budget.maxAgentRuns}</span></dd></div>
        </dl>
      </header>

      {headline && task.status !== 'waiting_input' && (
        <div className={`now-line now-line--${headline.tone}`}>
          <span className="now-line__dot" aria-hidden />
          <span className="grow now-line__text">
            <span role="status" aria-live="polite">{headline.text}</span>
            {headline.last && <span className="now-line__last">Last reported: {headline.last.text} · {now - headline.last.at < 2000 ? 'just now' : `${duration(now - headline.last.at)} ago`}</span>}
          </span>
          {headline.basis === 'inferred' && <span className="faint now-line__basis" title="Deduced from the engine's stage records">inferred</span>}
          <span className="now-line__actions"><DecisionBar task={task} blockingWarnings={0} /></span>
        </div>
      )}

      {task.status === 'waiting_input' && <DecisionBar task={task} blockingWarnings={warnings.filter((w) => w.tone === 'bad').length} />}

      <div className="ops-grid">
      <section className="hx-panel relay-panel" aria-label="Live operations">
        <div className="relay-panel__bar">
          <h2 className="hx-panel__title row"><Waypoints size={15} aria-hidden /> Relay</h2>
          <Segmented label="Explore the work" value={visual} onChange={value => { setVisual(value); setCursor(null); setPlaying(false) }} options={[{ value: 'workflow', label: 'Workspaces' }, { value: 'timeline', label: 'Timeline' }, { value: 'artifacts', label: 'Evidence path' }]} />
          {visual === 'timeline' && <span className="relay-panel__legend faint">Bars: recorded work · outlined: inferred · ◆ outputs handed on</span>}
          <span className="grow" />
          {cursor !== null && <span className="faint num">{duration(cursor - (shown?.start ?? 0))} into the task</span>}
          {visual === 'timeline' && <Button size="sm" variant="ghost" icon={playing ? <Pause size={13} /> : <Play size={13} />} onClick={() => { if (!playing && cursor === null && shown) setCursor(shown.start); setPlaying(!playing) }}>{playing ? 'Pause replay' : 'Replay'}</Button>}
          {cursor !== null && <Button size="sm" variant="ghost" icon={<Rewind size={13} />} onClick={() => { setPlaying(false); setCursor(null) }}>Back to now</Button>}
          {live && <Button size="sm" variant="ghost" aria-pressed={Boolean(frozen)} onClick={() => { if (frozen) { setFrozen(null); setMissed(0) } else setFrozen(current) }}>{frozen ? `Resume view${missed ? ` · ${missed} update${missed === 1 ? '' : 's'}` : ''}` : 'Freeze view'}</Button>}
          {visual === 'timeline' && <Button size="sm" variant="ghost" icon={<List size={13} />} aria-pressed={listView} onClick={() => setListView(!listView)}>{listView ? 'Diagram' : 'List'}</Button>}
        </div>
        {frozen && <p className="relay-panel__note">The view is frozen. Hydra keeps working; resume to catch up.</p>}
        <div className="relay-panel__body">
          {!shown ? <p className="faint">Loading…</p> : visual === 'workflow' ? <Workflow trace={shown} onSelect={setSelection} /> : visual === 'artifacts' ? <ArtifactPath trace={shown} onSelect={setSelection} /> : listView ? <TraceList trace={shown} cursor={cursor} onSelect={setSelection} /> : (
            <RelayTrace trace={shown} selection={active} onSelect={setSelection} cursor={cursor} />
          )}
          {shown && visual === 'timeline' && (
            <input className="relay-panel__scrub" type="range" aria-label="Replay position" min={shown.start} max={shown.live ? shown.now : shown.end} step={250}
              value={cursor ?? (shown.live ? shown.now : shown.end)} onChange={(e) => { setPlaying(false); const v = Number(e.target.value); setCursor(v >= (shown.live ? shown.now : shown.end) - 250 ? null : v) }} />
          )}
        </div>
      </section>
      {shown && (cursor !== null || frozen) && <div className="ops-grid__side"><p className="hx-panel__body muted">This view is paused in time. Return to now to inspect the latest outputs and evidence; historical streamed output is not retained.</p></div>}
      {shown && cursor === null && !frozen && <div className="ops-grid__side"><Inspector trace={shown} task={task} runs={runs} evidence={evidence} selection={active} onSelect={setSelection} /></div>}
      </div>

      <div className="task-grid">
        <section className="hx-panel task-grid__main">
          <Tabs<TabId> value={tab} onChange={setTab} tabs={[
            { id: 'summary', label: 'Summary', icon: <ScrollText size={14} /> },
            { id: 'changes', label: 'Changes', icon: <FileDiff size={14} />, count: diff?.files.length },
            { id: 'checks', label: 'Checks', icon: <FlaskConical size={14} />, count: evidence.length },
            { id: 'log', label: 'Log', icon: <List size={14} /> }
          ]} />
          <div className="hx-panel__body">
            {tab === 'summary' && <OverviewTab task={task} warnings={warnings} />}
            {tab === 'changes' && <ChangesTab diff={diff} error={diffError} removed={!hasWorkspace} />}
            {tab === 'checks' && <ChecksTab task={task} evidence={evidence} />}
            {tab === 'log' && <ActivityTab task={task} />}
          </div>
        </section>
      </div>
    </>
  )
}

/** What to show before the person picks anything: what needs them, else what is happening, else the last artifact. */
function defaultSelection(trace: Trace): Selection {
  const gate = trace.segments.find((s) => s.kind === 'gate' && s.status === 'waiting')
  if (gate) return { kind: 'segment', id: gate.id }
  const running = [...trace.segments].reverse().find((s) => s.end === null && s.kind === 'run')
  if (running) return { kind: 'segment', id: running.id }
  const last = trace.batons.at(-1)
  return last ? { kind: 'baton', id: last.id } : null
}

