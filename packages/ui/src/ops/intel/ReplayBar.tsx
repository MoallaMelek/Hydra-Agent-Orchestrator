import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import type { IntelGraph } from './graph'
import { fmtOffset } from './text'

/** Each gap between recorded moments plays for at most this long; quiet time is shortened, never invented. */
const MAX_GAP_MS = 900
const MIN_GAP_MS = 140

/**
 * Replay through recorded time. The cursor shows the mission as it was at that instant
 * (projectAt): later records are absent and outcomes never leak backwards. Playback moves
 * continuously through recorded time with long quiet gaps shortened, so every tool call,
 * handoff, check and finding appears in its recorded order at its recorded moment.
 * Reduced motion steps from moment to moment instead.
 */
export function ReplayBar({ graph, cursor, onCursor, reduced }: { graph: IntelGraph; cursor: number | null; onCursor: (c: number | null) => void; reduced: boolean }) {
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const frame = useRef(0)
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  const span = Math.max(1, graph.end - graph.start)
  const value = cursor === null ? 1000 : Math.round(((cursor - graph.start) / span) * 1000)

  useEffect(() => {
    if (!playing) return
    const marks = [graph.start, ...graph.moments.filter((m) => m > graph.start && m < graph.end), graph.end]
    const from = cursorRef.current ?? graph.start
    if (reduced) {
      const rest = marks.filter((m) => m > from)
      let i = 0
      const timer = setInterval(() => { const m = rest[i++]; if (m === undefined || m >= graph.end) { clearInterval(timer); setPlaying(false); onCursor(null) } else onCursor(m) }, 900)
      if (cursorRef.current === null) onCursor(graph.start)
      return () => clearInterval(timer)
    }
    // Map play time to recorded time, segment by segment.
    const segs = marks.slice(1).map((m, i) => { const a = marks[i]!, real = m - a; return { a, real, play: real <= 0 ? 0 : Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, real)) } })
    let seg = segs.findIndex((s) => s.a + s.real > from)
    if (seg < 0) seg = 0
    let within = segs[seg] && segs[seg]!.real > 0 ? ((from - segs[seg]!.a) / segs[seg]!.real) * segs[seg]!.play : 0
    let last = performance.now()
    const step = (t: number) => {
      within += (t - last) * speed; last = t
      while (segs[seg] && within >= segs[seg]!.play) { within -= segs[seg]!.play; seg++ }
      const s = segs[seg]
      if (!s) { setPlaying(false); onCursor(null); return }
      onCursor(s.a + (s.play ? (within / s.play) * s.real : 0))
      frame.current = requestAnimationFrame(step)
    }
    if (cursorRef.current === null) onCursor(graph.start)
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
    // Restart only when play or speed toggles; the cursor advances inside the loop.
  }, [playing, speed])

  const recordsSoFar = cursor === null ? null : graph.moments.filter((m) => m <= cursor).length
  return <div className="replay" role="group" aria-label="Replay recorded moments">
    <button className="hx-btn hx-btn--sm" aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}{playing ? 'Pause' : 'Replay'}</button>
    {!reduced && <div className="hx-seg replay__speed" role="group" aria-label="Replay speed">{[1, 3].map((x) => <button key={x} type="button" aria-pressed={speed === x} onClick={() => setSpeed(x)}>{x}×</button>)}</div>}
    <div className="replay__track">
      <div className="replay__ticks" aria-hidden>{graph.moments.map((m) => <i key={m} style={{ left: `${((m - graph.start) / span) * 100}%` }} />)}</div>
      <input type="range" min={0} max={1000} value={value} aria-label="Replay position" aria-valuetext={cursor === null ? 'End of record' : fmtOffset(cursor, graph.start)}
        onChange={(e) => { setPlaying(false); const v = Number(e.target.value) / 1000; onCursor(v >= 1 ? null : graph.start + v * span) }} />
    </div>
    <span className="replay__text mono" aria-live="off">{cursor === null ? (graph.live ? 'Now · all records' : 'End · all records') : `${fmtOffset(cursor, graph.start)} · ${recordsSoFar} of ${graph.moments.length} moments${playing ? ' · quiet gaps shortened' : ''}`}</span>
    {cursor !== null && <button className="hx-btn hx-btn--sm hx-btn--ghost" onClick={() => { setPlaying(false); onCursor(null) }}>Back to {graph.live ? 'now' : 'end'}</button>}
  </div>
}
