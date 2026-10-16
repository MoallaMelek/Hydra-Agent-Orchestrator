import { memo } from 'react'
import { ArrowRight, Check, FileCode2, Hand, Pause, Search, ShieldCheck, Wrench } from 'lucide-react'
import type { Trace, Segment, LaneId } from './model'
import type { Selection } from './RelayTrace'
import { duration } from '../lib/format'
import './workflow.css'

const ICON = { you: Hand, planner: Search, implementer: Wrench, reviewer: ShieldCheck, hydra: Check }
const VERB: Record<LaneId, string> = { you: 'Your direction', planner: 'Understand the request', implementer: 'Make the change', reviewer: 'Challenge the result', hydra: 'Test and deliver' }
const STATUS: Record<Segment['status'], string> = { running: 'Execution in progress', ok: 'Execution finished', failed: 'Needs attention', canceled: 'Stopped', waiting: 'Waiting', interrupted: 'Interrupted' }

/** A spatial view of the SAME records as Relay. No imaginary station activity. */
export const Workflow = memo(function Workflow({ trace, onSelect }: { trace: Trace; onSelect: (selection: Selection) => void }) {
  return <div className="workfloor" aria-label="Workflow overview">
    <div className="workfloor__intro"><h3>Team and evidence</h3><p>Select a workspace to inspect the work, files and results recorded there.</p></div>
    <div className="workfloor__stations">{trace.lanes.filter(lane => lane.id !== 'you').map(lane => {
      const operations = trace.segments.filter(segment => segment.lane === lane.id)
      const current = operations.findLast(segment => segment.end === null) ?? (lane.id === 'hydra' ? operations.findLast(segment => segment.kind === 'check' && segment.stage === 'verify') : undefined) ?? operations.at(-1)
      const artifacts = trace.batons.filter(baton => baton.lane === lane.id)
      const last = artifacts.at(-1)
      const Icon = ICON[lane.id]
      return <section key={lane.id} className={`station station--${current?.status ?? 'empty'}`}>
        <button className="station__select" onClick={() => onSelect(current ? { kind: 'segment', id: current.id } : { kind: 'lane', id: lane.id })}>
          <span className="station__actor"><Icon size={18} aria-hidden /><span>{lane.actor}</span></span>
          <strong>{VERB[lane.id]}</strong>
          <span className="station__duty">{lane.duty}</span>
          <span className="station__state">{current ? STATUS[current.status] : last ? 'Recorded input available' : 'No recorded work yet'}{current?.basis === 'inferred' ? ' · inferred' : ''}</span>
          {current && <span className="station__operation">{current.label}<small>{current.end === null ? 'Open execution' : duration(Math.max(0, current.end - current.start))} · {operations.length} operation{operations.length === 1 ? '' : 's'}</small></span>}
        </button>
        {last && <button className="station__artifact" onClick={() => onSelect({ kind: 'baton', id: last.id })}><FileCode2 size={14} aria-hidden /><span>{last.label}{last.basis === 'inferred' && <small>Inferred from recorded stages</small>}</span>{last.to && <><ArrowRight size={13} aria-hidden /><span>{trace.lanes.find(target => target.id === last.to)?.title}</span></>}</button>}
      </section>
    })}</div>
    <p className="workfloor__note"><Pause size={13} aria-hidden /> Stillness means no new event has been reported. Hydra never invents activity to fill a workspace.</p>
  </div>
})

/** Output-led alternative: useful to a newcomer asking “what did I get?” */
export const ArtifactPath = memo(function ArtifactPath({ trace, onSelect }: { trace: Trace; onSelect: (selection: Selection) => void }) {
  return <div className="artifact-path" aria-label="Recorded artifacts and handoffs">
    <header><h3>The evidence path</h3><p>Outputs appear here when their recorded handoff occurs. Select an output to inspect its source.</p></header>
    <ol>{trace.batons.map(baton => <li key={baton.id}>
      <button onClick={() => onSelect({ kind: 'baton', id: baton.id })}>
        <time className="num">{duration(Math.max(0, baton.at - trace.start))}</time>
        <span><strong>{baton.label}</strong><small>{trace.lanes.find(lane => lane.id === baton.lane)?.title}{baton.to ? ` → ${trace.lanes.find(lane => lane.id === baton.to)?.title ?? baton.to}` : ''} · {baton.basis === 'observed' ? 'Recorded' : 'Inferred from stage records'}</small></span>
        <ArrowRight size={16} aria-hidden />
      </button>
    </li>)}</ol>
  </div>
})
