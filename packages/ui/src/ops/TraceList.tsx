import type { Trace } from './model'
import type { Selection } from './RelayTrace'
import { duration } from '../lib/format'

/** The same trace as a chronological list: readable with a screen reader, searchable by eye. */
export function TraceList({ trace, cursor, onSelect }: { trace: Trace; cursor: number | null; onSelect: (s: Selection) => void }) {
  const at = cursor ?? trace.now
  const lane = (id: string) => trace.lanes.find((l) => l.id === id)
  const items = [
    ...trace.segments.filter((s) => s.start <= at).map((s) => ({ at: s.start, key: `s-${s.id}`, who: lane(s.lane), text: s.label, note: s.end === null || s.end > at ? 'in progress' : duration(Math.max(0, s.end - s.start)), basis: s.basis, select: { kind: 'segment' as const, id: s.id }, tone: s.end === null || s.end > at ? 'running' : s.status })),
    ...trace.batons.filter((b) => b.at <= at).map((b) => ({ at: b.at, key: `b-${b.id}`, who: lane(b.lane), text: `◆ ${b.label}${b.to ? ` → ${lane(b.to)?.title ?? b.to}` : ''}`, note: '', basis: b.basis, select: { kind: 'baton' as const, id: b.id }, tone: b.tone }))
  ].sort((a, b) => a.at - b.at)
  return (
    <ol className="trace-list">
      {items.map((item) => (
        <li key={item.key}>
          <button type="button" className={`trace-list__row trace-list__row--${item.tone}`} onClick={() => onSelect(item.select)}>
            <span className="trace-list__t num">{duration(Math.max(0, item.at - trace.start))}</span>
            <span className="trace-list__who">{item.who?.title}{item.who && item.who.actor !== item.who.title ? <span className="faint"> · {item.who.actor}</span> : null}</span>
            <span className="trace-list__text">{item.text}</span>
            <span className="trace-list__note faint">{item.note}{item.basis === 'inferred' ? ' · inferred' : ''}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
