import { useEffect, useMemo, useRef, useState } from 'react'
import type { Task } from '@hydra/protocol'
import { Badge, Tabs } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { MODE_INFO, money, statusLabel } from '../lib/format'
import { useTaskLoaded } from '../ops/hooks'
import { projectAt, type IntelGraph } from '../ops/intel/graph'
import { layoutMission } from '../ops/intel/layout'
import { IntelNetwork, useReducedMotion } from '../ops/intel/IntelNetwork'
import { EvidenceInspector } from '../ops/intel/EvidenceInspector'
import { TimelineLens } from '../ops/intel/TimelineLens'
import { ReplayBar } from '../ops/intel/ReplayBar'
import { useIntel } from '../ops/intel/useIntel'
import { fmtOffset, ROLE_NAME } from '../ops/intel/text'
import { DecisionBar } from './task/DecisionBar'
import { OverviewTab } from './task/OverviewTab'
import { ChangesTab } from './task/ChangesTab'
import { ChecksTab } from './task/ChecksTab'
import { ActivityTab } from './task/ActivityTab'
import { MissionReceipt } from './task/MissionReceipt'
import { approvalWarnings } from './task/warnings'
import { useTaskDiff } from './task/useTaskData'

type LensId = 'network' | 'timeline' | 'records'
type RecordTab = 'summary' | 'changes' | 'checks' | 'log'

/** One sentence about now, from records only (VOICE: running, waiting, outcome; never "thinking"). */
function nowLine(g: IntelGraph): string {
  const t = g.task
  const run = g.nodes.find((n) => n.kind === 'run' && n.status === 'running')
  if (run && run.runFacts) {
    const f = run.runFacts
    return `${ROLE_NAME[run.actor ?? ''] ?? 'Agent'} is running · ${f.activity.length} reported call${f.activity.length === 1 ? '' : 's'} · started ${run.at !== null ? fmtOffset(run.at, g.start) : ''}`
  }
  const check = g.nodes.find((n) => n.kind === 'check' && n.status === 'running')
  if (check) return `Hydra is running ${check.label}`
  if (t.status === 'waiting_input') return t.waitReason === 'plan_approval' ? 'The plan is ready. Nothing has been written yet.' : t.waitReason === 'final_approval' ? `Revision ${t.workspace?.headSha?.slice(0, 7) ?? ''} waits for your decision.` : 'Waiting for your input.'
  if (t.status === 'queued') return 'Queued · waiting for a free agent slot.'
  if (t.status === 'failed') return t.error ?? 'The mission failed.'
  if (t.status === 'paused') return 'Paused · resume when ready.'
  if (t.status === 'canceled') return 'Canceled.'
  if (t.status === 'completed') return t.outcome === 'applied' ? `Applied ${t.applied?.afterSha?.slice(0, 7) ?? ''} to ${t.applied?.targetBranch ?? "your branch"}.` : `Closed · ${String(t.outcome ?? 'done').replace('_', ' ')}.`
  return 'Between steps.'
}

export function MissionView({ task }: { task: Task }) {
  const { go } = useApp()
  const project = useAppState((s) => s.projects.find((p) => p.id === task.projectId))
  const loaded = useTaskLoaded(task.id)
  const { graph: full, diffError } = useIntel(task)
  const reduced = useReducedMotion()
  const [lens, setLens] = useState<LensId>('network')
  const [records, setRecords] = useState<RecordTab>('summary')
  const [cursor, setCursor] = useState<number | null>(null)
  const waiting = task.status === 'waiting_input'
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const delivery = useRef<HTMLDivElement>(null)

  // Layout is computed from the full record so replay never moves a mark that already exists.
  // While a mission runs the graph is rebuilt every second; positions only change when records
  // (nodes or links) are added, so the layout and the camera stay still between ticks.
  const shape = `${full.nodes.map((n) => n.id).join('|')}#${full.edges.map((e) => e.id).join('|')}`
  const fullRef = useRef(full)
  fullRef.current = full
  const layout = useMemo(() => layoutMission(fullRef.current), [shape])
  const graph = useMemo(() => projectAt(full, cursor), [full, cursor])
  useEffect(() => { if (selected && !graph.byId.has(selected)) setSelected(null); if (focus && !graph.byId.has(focus)) setFocus(null) }, [graph, selected, focus])

  const evidence = useAppState((s) => s.evidence[task.id])
  const hasWorkspace = Boolean(task.workspace && !task.workspace.removed)
  const { diff, error: recordsDiffError } = useTaskDiff(task.id, task.workspace?.headSha, hasWorkspace && (lens === 'records' && records === 'changes' || waiting))
  const warnings = approvalWarnings(task, evidence ?? [], diff)
  const blocking = warnings.filter((w) => w.tone === 'bad').length
  const status = statusLabel(task)
  const revisions = full.counts.revision
  const node = selected ? graph.byId.get(selected) ?? null : null
  const toDelivery = () => { delivery.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); delivery.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }

  return <div className="mission">
    <header className="mission__head">
      <nav className="crumbs" aria-label="Breadcrumbs"><button onClick={() => go({ view: 'home' })}>Home</button><span aria-hidden>/</span>{project && <><button onClick={() => go({ view: 'project', projectId: project.id })}>{project.name}</button><span aria-hidden>/</span></>}<span>Mission</span></nav>
      <div className="mission__title">
        <h1>{task.title}</h1>
        <div className="mission__lenses">
          <Tabs<LensId> value={lens} onChange={setLens} tabs={[{ id: 'network', label: 'Network' }, { id: 'timeline', label: 'Timeline' }, { id: 'records', label: 'Records' }]} />
        </div>
      </div>
      <div className="mission__nowrow">
        <p className="mission__now" role="status"><span className={`now-dot s-${waiting ? 'waiting' : task.status}`} aria-hidden />{nowLine(full)}</p>
        <div className="mission__meta">
          <Badge tone={status.tone} live={status.live}>{status.label}</Badge>
          <span className="mono faint">{MODE_INFO[task.mode].label} · {revisions} revision{revisions === 1 ? '' : 's'} · {full.counts.check} check{full.counts.check === 1 ? '' : 's'}{task.fixRound > 0 ? ` · ${task.fixRound} repair round${task.fixRound === 1 ? '' : 's'}` : ''}</span>
          <span className="mono faint" title="Reported by the provider CLIs; may arrive late">{money(task.usage.costUsd)}{task.usage.unpricedTokens > 0 ? ' + unpriced' : ''} reported</span>
          {(task.status === 'running' || task.status === 'queued') && <div className="mission__stop" role="region" aria-label="Mission controls" inert={cursor !== null}><DecisionBar task={task} blockingWarnings={blocking} /></div>}
        </div>
      </div>
    </header>

    {waiting && <div ref={delivery} className={`delivery delivery--waiting ${cursor !== null ? 'is-replay' : ''}`} id="delivery" role="region" aria-label="Your decision" inert={cursor !== null}>
      <DecisionBar task={task} blockingWarnings={blocking} />
    </div>}


    {lens !== 'records' ? <div className="mission__stage">
      <div className="mission__main">
        {!loaded && <p className="mission__loading" role="status">Loading recorded runs and checks…</p>}
        {lens === 'network'
          ? <IntelNetwork graph={graph} layout={layout} lens="mission" label="Mission evidence map" selected={selected} onSelect={setSelected} focus={focus} onFocus={setFocus} cursor={cursor} />
          : <TimelineLens graph={graph} full={full} selected={selected} onSelect={setSelected} />}
        {full.moments.length > 2 && <ReplayBar graph={full} cursor={cursor} onCursor={setCursor} reduced={reduced} />}
        {cursor !== null && <p className="replay-note" role="note">Replay · showing records up to {fmtOffset(cursor, full.start)}. Decisions are disabled in replay; return to {full.live ? 'now' : 'the end'} to act.</p>}
        {diffError && hasWorkspace && <p className="faint replay-note">The diff could not be loaded: {diffError}</p>}
      </div>
      <aside className="mission__inspector" aria-label="Evidence inspector">
        <EvidenceInspector graph={graph} node={node} focused={focus} onSelect={setSelected} onFocus={(id) => setFocus(focus === id ? null : id)} onDeliver={waiting && cursor === null ? toDelivery : undefined} at={cursor !== null ? fmtOffset(cursor, full.start) : undefined} />
      </aside>
    </div> : <section className="hx-panel mission__records" aria-label="Recorded work">
      <Tabs<RecordTab> value={records} onChange={setRecords} tabs={[{ id: 'summary', label: 'Summary' }, { id: 'changes', label: 'Changes', count: diff?.files.length }, { id: 'checks', label: 'Checks', count: evidence?.length }, { id: 'log', label: 'Log' }]} />
      <div className="hx-panel__body">
        {records === 'summary' && <><OverviewTab task={task} warnings={warnings} /><MissionReceipt task={task} evidence={evidence ?? []} /></>}
        {records === 'changes' && <ChangesTab diff={diff} error={recordsDiffError} removed={!hasWorkspace} />}
        {records === 'checks' && <ChecksTab task={task} evidence={evidence ?? []} />}
        {records === 'log' && <ActivityTab task={task} />}
      </div>
    </section>}

    {!waiting && task.status !== 'running' && task.status !== 'queued' && <div className="mission__after" aria-label="Mission controls"><DecisionBar task={task} blockingWarnings={blocking} /></div>}
  </div>
}
