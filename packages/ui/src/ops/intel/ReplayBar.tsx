import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import type { IntelGraph } from './graph'
import { fmtOffset } from './text'

/**
 * Replay through recorded moments only. The cursor shows the mission as it was at that
 * instant (projectAt): later records are absent and outcomes never leak backwards.
 */
export function ReplayBar({ graph, cursor, onCursor, reduced }: { graph: IntelGraph; cursor: number | null; onCursor: (c: number | null) => void; reduced: boolean }) {
  const [playing, setPlaying] = useState(false)
  const frame = useRef(0)
  const span = Math.max(1, graph.end - graph.start)
  const value = cursor === null ? 1000 : Math.round(((cursor - graph.start) / span) * 1000)

  useEffect(() => {
    if (!playing) return
    const moments = graph.moments.filter((m) => cursor === null || m > cursor)
    let i = 0, last = 0
    const step = (t: number) => {
      if (t - last > (reduced ? 900 : 420)) {
        last = t
        const m = moments[i++]
        if (m === undefined || m >= graph.end) { setPlaying(false); onCursor(null); return }
        onCursor(m)
      }
      frame.current = requestAnimationFrame(step)
    }
    if (cursor === null) onCursor(graph.start)
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
    // Restart only when play toggles; the cursor advances inside the loop.
  }, [playing])

  const recordsSoFar = cursor === null ? null : graph.moments.filter((m) => m <= cursor).length
  return <div className="replay" role="group" aria-label="Replay recorded moments">
    <button className="hx-btn hx-btn--sm" aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}{playing ? 'Stop' : 'Replay'}</button>
    <div className="replay__track">
      <div className="replay__ticks" aria-hidden>{graph.moments.map((m) => <i key={m} style={{ left: `${((m - graph.start) / span) * 100}%` }} />)}</div>
      <input type="range" min={0} max={1000} value={value} aria-label="Replay position" aria-valuetext={cursor === null ? 'End of record' : fmtOffset(cursor, graph.start)}
        onChange={(e) => { setPlaying(false); const v = Number(e.target.value) / 1000; onCursor(v >= 1 ? null : graph.start + v * span) }} />
    </div>
    <span className="replay__text mono" aria-live="off">{cursor === null ? (graph.live ? 'Now · all records' : 'End · all records') : `${fmtOffset(cursor, graph.start)} · ${recordsSoFar} of ${graph.moments.length} moments`}</span>
    {cursor !== null && <button className="hx-btn hx-btn--sm hx-btn--ghost" onClick={() => { setPlaying(false); onCursor(null) }}>Back to {graph.live ? 'now' : 'end'}</button>}
  </div>
}
