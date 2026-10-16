import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Baton, LaneId, Segment, Trace } from './model'
import { duration } from '../lib/format'

export type Selection = { kind: 'segment'; id: string } | { kind: 'baton'; id: string } | { kind: 'lane'; id: LaneId } | null

const STATUS_WORD: Record<Segment['status'], string> = { running: 'in progress', ok: 'done', failed: 'failed', canceled: 'canceled', waiting: 'waiting', interrupted: 'interrupted' }

/** Ticks on the time axis: about six, at round intervals. */
function axis(span: number): number[] {
  const steps = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].map((s) => s * 1000)
  const step = steps.find((s) => span / s <= 7) ?? 14_400_000
  const out: number[] = []
  for (let x = 0; x <= span; x += step) out.push(x)
  return out
}
const clock = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 3600 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
}

interface Props {
  trace: Trace
  selection: Selection
  onSelect: (selection: Selection) => void
  /** Replay: draw the task as it was at this moment. */
  cursor?: number | null
  compact?: boolean
}

/**
 * The task as a relay: one lane per actor, the work each really did, and the artifacts
 * handed between them. Positions are percentages of the time domain, so a live task
 * re-renders once a second with no animation in between.
 */
export const RelayTrace = memo(function RelayTrace({ trace, selection, onSelect, cursor = null, compact = false }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // Elements present on first render appear still; only work that arrives later animates in.
  const initial = useRef<Set<string> | null>(null)
  if (initial.current === null) initial.current = new Set([...trace.segments.map((s) => s.id), ...trace.batons.map((b) => b.id)])

  const at = cursor ?? trace.now
  const span = Math.max(1, trace.end - trace.start)
  const pct = (time: number) => `${Math.min(100, Math.max(0, ((time - trace.start) / span) * 100))}%`
  const segments = trace.segments.filter((s) => s.start <= at)
  const batons = trace.batons.filter((b) => b.at <= at)
  const laneIndex = new Map(trace.lanes.map((l, i) => [l.id, i]))

  // Baton labels: hide a label that would overlap the previous one on its lane (its marker stays).
  const labelled = useMemo(() => {
    const shown = new Set<string>()
    const lastEnd = new Map<LaneId, number>()
    for (const b of [...batons].sort((a, c) => a.at - c.at)) {
      const x = ((b.at - trace.start) / span) * width
      const w = Math.min(220, b.label.length * 6.6 + 22)
      if (x + w <= width + 8 && x >= (lastEnd.get(b.lane) ?? -Infinity)) { shown.add(b.id); lastEnd.set(b.lane, x + w + 6) }
    }
    return shown
  }, [batons, span, trace.start, width])

  const isSelected = (kind: 'segment' | 'baton', id: string) => selection?.kind === kind && selection.id === id

  return (
    <div className={`relay ${compact ? 'relay--compact' : ''}`} role="group" aria-label="Relay trace: who did what, over time">
      {!compact && (
        <div className="relay__stages" aria-hidden>
          <span className="relay__gutter" />
          <div className="relay__band">
            {trace.stages.filter((s) => s.start <= at).map((s) => (
              <span key={`${s.stage}-${s.attempt}`} className={`relay__stage relay__stage--${s.status}`} style={{ left: pct(s.start), width: `calc(${pct(Math.min(s.end ?? at, at))} - ${pct(s.start)})` }}>
                <span className="truncate">{STAGE_LABEL[s.stage]}{s.stage === 'fix' || s.attempt > 1 ? ` ${s.attempt}` : ''}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="relay__lanes">
        {trace.lanes.map((lane) => (
          <div key={lane.id} className={`relay__lane ${selection?.kind === 'lane' && selection.id === lane.id ? 'is-selected' : ''}`}>
            {!compact && (
              <button type="button" className="relay__who" onClick={() => onSelect({ kind: 'lane', id: lane.id })} title={lane.duty}>
                <span className="relay__role">{lane.title}</span>
                {lane.actor !== lane.title && <span className="relay__actor truncate">{lane.actor}</span>}
              </button>
            )}
            <div className="relay__track" ref={lane.id === 'you' ? track : undefined}>
              {segments.filter((s) => s.lane === lane.id).map((s) => {
                const end = s.end === null ? at : Math.min(s.end, at)
                const open = s.end === null || s.end > at
                const Tag = compact ? 'span' : 'button'
                return (
                  <Tag
                    key={s.id} type={compact ? undefined : 'button'}
                    className={`relay__seg relay__seg--${s.kind} relay__seg--${s.status} ${s.basis === 'inferred' ? 'is-inferred' : ''} ${open ? 'is-open' : ''} ${isSelected('segment', s.id) ? 'is-selected' : ''}`}
                    data-fresh={initial.current!.has(s.id) ? undefined : ''}
                    style={{ left: pct(s.start), width: `max(4px, calc(${pct(end)} - ${pct(s.start)}))` }}
                    onClick={compact ? undefined : () => onSelect({ kind: 'segment', id: s.id })}
                    aria-label={`${lane.title}${lane.actor !== lane.title ? ` (${lane.actor})` : ''}: ${s.label}, ${duration(Math.max(0, end - s.start))}, ${STATUS_WORD[s.status]}${s.basis === 'inferred' ? ', inferred' : ''}`}
                  >
                    {!compact && ((Math.min(end, trace.end) - s.start) / span) * width >= s.label.length * 6.4 + 16 && <span className="relay__seg-label truncate">{s.label}</span>}
                    {!compact && s.ticks.length > 0 && <Ticks ticks={s.ticks} start={s.start} end={end} at={at} />}
                  </Tag>
                )
              })}
              {!compact && batons.filter((b) => b.lane === lane.id).map((b) => (
                <BatonMark key={b.id} baton={b} left={pct(b.at)} labelled={labelled.has(b.id)} fresh={!initial.current!.has(b.id)} selected={isSelected('baton', b.id)} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
        <div className="relay__overlay" aria-hidden>
          {!compact && batons.filter((b) => b.to && laneIndex.has(b.to)).map((b) => {
            const from = laneIndex.get(b.lane)!
            const to = laneIndex.get(b.to!)!
            if (from === to) return null
            // From the baton (lower part of its lane) to the middle of the receiving lane's work.
            const down = to > from
            const top = down ? `calc(${from} * var(--lane-h) + var(--lane-h) * 0.66)` : `calc(${to} * var(--lane-h) + var(--lane-h) * 0.5)`
            const height = down ? `calc(${to - from} * var(--lane-h) - var(--lane-h) * 0.16)` : `calc(${from - to} * var(--lane-h) + var(--lane-h) * 0.16)`
            return <span key={b.id} className={`relay__link relay__link--${b.tone} ${down ? 'is-down' : 'is-up'} ${b.kind === 'repair' ? 'is-repair' : ''}`}
              style={{ left: pct(b.at), top, height }} />
          })}
          {trace.live && cursor === null && <span className="relay__now" style={{ left: pct(trace.now) }} />}
          {cursor !== null && <span className="relay__cursor" style={{ left: pct(cursor) }} />}
        </div>
      </div>
      {!compact && (
        <div className="relay__axis" aria-hidden>
          <span className="relay__gutter" />
          <div className="relay__ticks">
            {axis(span).map((x) => <span key={x} style={{ left: pct(trace.start + x) }}>{clock(x)}</span>)}
          </div>
        </div>
      )}
    </div>
  )
})

const STAGE_LABEL: Record<string, string> = { plan: 'Plan', implement: 'Implement', review: 'Review', fix: 'Fix', verify: 'Verify', demo: 'Before/after', approval: 'Approval', apply: 'Apply' }

/** Tool calls as short marks inside a run (at most 120 drawn; the inspector lists them all). */
const Ticks = memo(function Ticks({ ticks, start, end, at }: { ticks: Segment['ticks']; start: number; end: number; at: number }) {
  const span = Math.max(1, end - start)
  const visible = ticks.filter((t) => t.at <= at)
  const step = Math.max(1, Math.ceil(visible.length / 120))
  return (
    <span className="relay__ticks-in" aria-hidden>
      {visible.filter((_, i) => i % step === 0).map((t, i) => <i key={i} className={`k-${t.kind}`} style={{ left: `${Math.min(100, ((t.at - start) / span) * 100)}%` }} />)}
    </span>
  )
})

function BatonMark({ baton, left, labelled, fresh, selected, onSelect }: { baton: Baton; left: string; labelled: boolean; fresh: boolean; selected: boolean; onSelect: (s: Selection) => void }) {
  return (
    <button type="button" className={`relay__baton relay__baton--${baton.tone} ${selected ? 'is-selected' : ''}`} style={{ left }} data-fresh={fresh ? '' : undefined}
      onClick={() => onSelect({ kind: 'baton', id: baton.id })} title={baton.label} aria-label={`${baton.label}${baton.to ? `, handed to ${baton.to}` : ''}`}>
      <span className="relay__baton-mark" />
      {labelled && <span className="relay__baton-label">{baton.label}</span>}
    </button>
  )
}
