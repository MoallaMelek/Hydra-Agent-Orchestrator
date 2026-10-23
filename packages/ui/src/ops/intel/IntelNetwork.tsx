import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Crosshair, List, Maximize2, Search, TriangleAlert } from 'lucide-react'
import type { IntelGraph, IntelKind, IntelNode } from './graph'
import { egoLayout, type Positions } from './layout'
import { labelOf, NetworkRenderer, type Lens } from './renderer'
import { KIND_NAME, KIND_PLURAL, neighbours, statusWord } from './text'

/** True when motion should be instant: system setting, or Settings → Display (reduced/minimal). */
export function useReducedMotion(): boolean {
  const read = () => matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.quality !== 'full' || ['reduced', 'minimal'].includes(document.documentElement.dataset.quality ?? '')
  const [reduced, setReduced] = useState(read)
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(read())
    mq.addEventListener('change', on)
    const mo = new MutationObserver(on)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-quality'] })
    return () => { mq.removeEventListener('change', on); mo.disconnect() }
  }, [])
  return reduced
}

const MISSION_CHANNELS: IntelKind[] = ['agent', 'run', 'file', 'revision', 'check', 'finding']
/** Edge and node kinds whose arrival is shown as light (each one a recorded event). */
const PULSE_EDGES = new Set(['handoff', 'edit', 'read', 'produced', 'reviewed', 'raised', 'concerns', 'decides'])
const FLASH_NODES = new Set(['run', 'revision', 'check', 'finding', 'decision'])
const PROJECT_CHANNELS: IntelKind[] = ['mission', 'file']
const LIST_ORDER: IntelKind[] = ['decision', 'stage', 'run', 'revision', 'check', 'finding', 'file', 'mission']

export interface IntelNetworkProps {
  graph: IntelGraph
  /** World positions for every node the graph can hold (stable across replay). */
  layout: Positions
  lens: Lens
  label: string
  selected: string | null
  onSelect: (id: string | null) => void
  /** Activate (open) a node; defaults to select. Project lens uses it to open a mission. */
  onActivate?: (id: string) => void
  focus?: string | null
  onFocus?: (id: string | null) => void
  cursor?: number | null
  /** Extra controls rendered at the right end of the toolbar. */
  tools?: React.ReactNode
  compact?: boolean
}

/**
 * The evidence map: a Canvas 2D drawing with an accessible DOM around it (toolbar, channel
 * filters, search, list alternative, live region). The canvas never holds information that
 * the list and the inspector do not also hold.
 */
export function IntelNetwork({ graph, layout, lens, label, selected, onSelect, onActivate, focus = null, onFocus, cursor = null, tools, compact }: IntelNetworkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<NetworkRenderer | null>(null)
  const reduced = useReducedMotion()
  const [hidden, setHidden] = useState<ReadonlySet<IntelKind>>(new Set())
  const [failures, setFailures] = useState(false)
  const [listMode, setListMode] = useState(() => matchMedia('(max-width: 600px)').matches)
  const [query, setQuery] = useState('')
  const [announce, setAnnounce] = useState('')
  const keyFocus = useRef<string | null>(null)
  const first = useRef(true)
  const liveId = useId()

  const scenePos = useMemo(() => {
    const m: Positions = new Map()
    for (const n of graph.nodes) { const p = layout.get(n.id); if (p) m.set(n.id, p) }
    return focus && graph.byId.has(focus) ? egoLayout(graph, m, focus) : m
  }, [graph, layout, focus])

  useEffect(() => {
    const canvas = canvasRef.current!
    const r = new NetworkRenderer(canvas)
    rendererRef.current = r
    const ro = new ResizeObserver(() => { r.fit(); r.draw() })
    ro.observe(canvas)
    const mo = new MutationObserver(() => r.refreshPalette())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    void document.fonts?.ready.then(() => r.requestDraw())
    return () => { ro.disconnect(); mo.disconnect(); r.dispose(); rendererRef.current = null }
  }, [])

  useEffect(() => { if (rendererRef.current) rendererRef.current.reducedMotion = reduced }, [reduced])

  // FORM on new records, EGO on focus; fit on first draw and when the lens or focus changes.
  const lastFocus = useRef<string | null>(null)
  const lastLayout = useRef<Positions | null>(null)
  const prevGraph = useRef<IntelGraph | null>(null)
  // Once you pan or zoom, new records never move the camera; Fit (0) hands it back.
  const userMoved = useRef(false)
  useEffect(() => {
    const r = rendererRef.current; if (!r) return
    r.setView({ lens, focus, hidden, failures, cursor })
    r.framing = layout
    const focusChanged = lastFocus.current !== focus
    if (focusChanged && !first.current) r.moveTo(scenePos, 360)
    else r.setScene(graph, scenePos, first.current ? 420 : 260)
    // Light for what was recorded since the last frame (replay advancing, or live events arriving).
    // A large jump (scrubbing) is shown as state only, without light.
    const prev = prevGraph.current
    if (prev && lens === 'mission' && prev.task?.id === graph.task?.id) {
      const had = new Set(prev.edges.map((e) => e.id)), hadNodes = new Set(prev.nodes.map((n) => n.id))
      const newEdges = graph.edges.filter((e) => !had.has(e.id) && PULSE_EDGES.has(e.kind))
      const newNodes = graph.nodes.filter((n) => !hadNodes.has(n.id) && FLASH_NODES.has(n.kind)).map((n) => n.id)
      const changed = graph.nodes.filter((n) => FLASH_NODES.has(n.kind) && hadNodes.has(n.id) && prev.byId.get(n.id)?.status !== n.status).map((n) => n.id)
      if (newEdges.length + newNodes.length <= 30) r.play(newEdges, [...newNodes, ...changed])
    }
    prevGraph.current = graph
    if (first.current || focusChanged || (lastLayout.current !== layout && !userMoved.current)) r.fit()
    first.current = false; lastFocus.current = focus; lastLayout.current = layout
  }, [graph, scenePos, layout, lens, focus, hidden, failures, cursor])
  const fit = () => { userMoved.current = false; rendererRef.current?.fit() }

  useEffect(() => { rendererRef.current?.setView({ selected }) }, [selected])
  useEffect(() => { if (!listMode) requestAnimationFrame(() => { rendererRef.current?.fit(); rendererRef.current?.draw() }) }, [listMode])

  const say = (n: IntelNode | undefined) => {
    if (!n) return
    const { ins, outs } = neighbours(graph, n.id)
    setAnnounce(`${KIND_NAME[n.kind]}: ${labelOf(n)}. ${statusWord(n)}. ${ins.length + outs.length} connections.`)
  }
  const activate = (id: string) => { if (onActivate) onActivate(id); else onSelect(id) }

  // Pointer: click selects, drag pans, wheel zooms, double-click focuses.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const local = (e: { clientX: number; clientY: number }) => { const b = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
  useEffect(() => {
    const canvas = canvasRef.current!
    const wheel = (e: WheelEvent) => { e.preventDefault(); userMoved.current = true; const p = local(e); rendererRef.current?.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y) }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    const r = rendererRef.current; if (!r) return
    const dir: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const d = dir[e.key]
    if (d) {
      e.preventDefault()
      keyFocus.current = r.nearest(keyFocus.current ?? selected, d[0], d[1])
      r.setView({ keyFocus: keyFocus.current })
      say(graph.byId.get(keyFocus.current ?? ''))
    } else if (e.key === 'Enter' && keyFocus.current) { e.preventDefault(); activate(keyFocus.current) }
    else if ((e.key === 'f' || e.key === 'F') && onFocus && (keyFocus.current ?? selected)) { e.preventDefault(); const id = (keyFocus.current ?? selected)!; onFocus(focus === id ? null : id) }
    else if (e.key === 'Escape') { if (focus && onFocus) onFocus(null); else { onSelect(null); keyFocus.current = null; r.setView({ keyFocus: null }) } }
    else if (e.key === '0') fit()
    else if (e.key === '+' || e.key === '=') { userMoved.current = true; r.zoomAt(1.2) }
    else if (e.key === '-') { userMoved.current = true; r.zoomAt(1 / 1.2) }
  }

  const channels = lens === 'mission' ? MISSION_CHANNELS : PROJECT_CHANNELS
  const results = query.trim() ? graph.nodes.filter((n) => !(lens === 'mission' && n.kind === 'mission') && (labelOf(n) + ' ' + n.detail).toLowerCase().includes(query.trim().toLowerCase())).slice(0, 10) : []
  const hasFailures = graph.nodes.some((n) => n.status === 'failed' || n.status === 'blocked')
  const focusNode = focus ? graph.byId.get(focus) : undefined

  return <section className={`net ${compact ? 'net--compact' : ''}`} aria-label={label}>
    <div className="net__bar">
      <div className="net__channels" role="group" aria-label="Show or hide record types">
        {channels.map((k) => {
          const count = graph.counts[k]
          if (!count && k !== 'decision') return null
          const on = !hidden.has(k)
          return <button key={k} className="chip" aria-pressed={on} onClick={() => { const next = new Set(hidden); if (on) next.add(k); else next.delete(k); setHidden(next) }}>
            <span className={`glyph g-${k}`} aria-hidden />{KIND_PLURAL[k]}<span className="mono">{count}</span>
          </button>
        })}

      </div>
      <div className="net__tools">
        <div className="net__find">
          <Search size={14} aria-hidden />
          <input type="search" aria-label="Find on the map" placeholder="Find a file, check, finding" value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); canvasRef.current?.focus() } if (e.key === 'Enter' && results[0]) { onSelect(results[0].id); rendererRef.current?.centreOn(results[0].id); setQuery('') } }} />
          {results.length > 0 && <ul className="net__results" aria-label="Matches">{results.map((n) => <li key={n.id}><button onClick={() => { onSelect(n.id); rendererRef.current?.centreOn(n.id); setQuery(''); canvasRef.current?.focus() }}><span className={`glyph g-${n.kind}`} aria-hidden />{labelOf(n)}<span className="faint"> · {KIND_NAME[n.kind]}</span></button></li>)}</ul>}
        </div>
        {hasFailures && <button className="chip" aria-pressed={failures} onClick={() => setFailures(!failures)} title="Light up failed checks, blocking findings and blocked decisions"><TriangleAlert size={13} aria-hidden />Failures</button>}
        <button className="chip" onClick={fit} title="Fit the map (0)"><Maximize2 size={13} aria-hidden />Fit</button>
        <button className="chip" aria-pressed={listMode} onClick={() => setListMode(!listMode)}><List size={13} aria-hidden />List</button>
        {tools}
      </div>
    </div>
    {focusNode && <div className="net__focus" role="status"><Crosshair size={14} aria-hidden /><span><b>Focus</b> {labelOf(focusNode)} <span className="faint">· inputs left, outputs right</span></span><button className="linkish" onClick={() => onFocus?.(null)}>Leave focus <kbd>Esc</kbd></button></div>}
    <div className="net__body">
      <canvas ref={canvasRef} className="net__canvas" hidden={listMode} tabIndex={0} role="application"
        aria-label={`${label}. Arrow keys move between records, Enter inspects, F focuses, Escape steps back.`} aria-describedby={liveId}
        onKeyDown={onKey}
        onBlur={() => { keyFocus.current = null; rendererRef.current?.setView({ keyFocus: null }) }}
        onPointerDown={(e) => { drag.current = { ...local(e), moved: false }; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => {
          const p = local(e), r = rendererRef.current; if (!r) return
          if (drag.current) { const dx = p.x - drag.current.x, dy = p.y - drag.current.y; if (drag.current.moved || Math.abs(dx) + Math.abs(dy) > 3) { drag.current = { ...p, moved: true }; userMoved.current = true; r.pan(dx, dy) } return }
          const h = r.hit(p.x, p.y)
          if (h !== r.view.hover) { r.setView({ hover: h }); e.currentTarget.style.cursor = h ? 'pointer' : 'grab' }
        }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) { const h = rendererRef.current?.hit(local(e).x, local(e).y) ?? null; if (h) { activate(h); say(graph.byId.get(h)) } else onSelect(null) } }}
        onPointerLeave={() => rendererRef.current?.setView({ hover: null })}
        onDoubleClick={(e) => { const h = rendererRef.current?.hit(local(e).x, local(e).y); if (h && onFocus) onFocus(focus === h ? null : h) }}
      />
      {listMode && <div className="net__list">
        {LIST_ORDER.map((k) => {
          const items = graph.nodes.filter((n) => n.kind === k && !(lens === 'mission' && k === 'mission') && !hidden.has(k))
          if (!items.length) return null
          return <div key={k}><h3>{KIND_PLURAL[k]} <span className="mono faint">{items.length}</span></h3><ul>{items.map((n) => <li key={n.id}><button className={`net__item ${n.id === selected ? 'is-selected' : ''}`} aria-current={n.id === selected || undefined} onClick={() => activate(n.id)}><span className={`glyph g-${n.kind} s-${n.status}`} aria-hidden /><span className="grow">{labelOf(n)}</span><span className="faint mono">{[n.kind === 'check' ? `${n.detail} · ${n.evidence!.commitSha.slice(0, 7)}` : '', statusWord(n), n.basis !== 'observed' ? n.basis : ''].filter(Boolean).join(' · ')}</span></button></li>)}</ul></div>
        })}
      </div>}
    </div>
    <div id={liveId} className="sr-only" aria-live="polite">{announce}</div>
  </section>
}
