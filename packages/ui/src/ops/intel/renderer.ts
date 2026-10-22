/**
 * Canvas renderer for the evidence network. Immediate mode, redrawn only when something
 * changes (selection, hover, animation frame of a named move, a recorded run still running).
 * Colours come from the design tokens on <html>, so Night and Day are a token swap.
 * Chosen over SVG after measurement: ~8.8 ms vs ~15.8 ms main-thread per restyle frame and
 * 0.4 s vs 2.4 s setup at 10,000 nodes (design/prototypes/bench.html, TEST_EVIDENCE).
 */
import type { IntelGraph, IntelKind, IntelNode } from './graph'
import { RX, RY, type Point, type Positions } from './layout'

export type Lens = 'mission' | 'project'
export interface ViewState {
  lens: Lens
  selected: string | null
  hover: string | null
  keyFocus: string | null
  focus: string | null
  hidden: ReadonlySet<IntelKind>
  failures: boolean
  /** Replay cursor; edges recorded within 4 s before it are drawn brighter. */
  cursor: number | null
}

interface Palette { void: string; deck: string; rule: string; ink: string; ink2: string; ink3: string; planner: string; builder: string; reviewer: string; engine: string; you: string; stop: string; night: boolean; sans: string; mono: string }

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    void: v('--void', '#07090c'), deck: v('--deck', '#0d1117'), rule: v('--rule', '#18202a'), ink: v('--ink', '#e8ecf1'), ink2: v('--ink-2', '#9ba6b4'), ink3: v('--ink-3', '#7b8696'),
    planner: v('--planner', '#74b9ff'), builder: v('--builder', '#ffb24a'), reviewer: v('--reviewer', '#3fd0c4'), engine: v('--engine', '#a9b6c6'), you: v('--you', '#f4efe3'), stop: v('--stop', '#ff5b52'),
    night: document.documentElement.dataset.theme !== 'light',
    sans: v('--font-sans', 'Archivo, "Segoe UI", system-ui, sans-serif'), mono: v('--font-mono', '"Azeret Mono", Consolas, monospace')
  }
}

const KIND_PRIORITY: Record<IntelKind, number> = { decision: 0, stage: 1, revision: 2, mission: 2, finding: 3, file: 4, run: 6, check: 7 }

export function labelOf(n: IntelNode): string {
  if (n.kind === 'file') return n.file!.path
  if (n.kind === 'revision') return `${n.revision!.short}${n.revision!.role === 'base' ? ' · base' : n.revision!.role === 'head' ? ' · head' : n.revision!.role === 'applied' ? ' · applied' : ''}`
  if (n.kind === 'check') return `${n.label} ${n.status === 'ok' ? '✓' : n.status === 'failed' ? '✕' : '…'}`
  if (n.kind === 'finding') return `${n.finding!.severity}: ${n.label.length > 42 ? n.label.slice(0, 40) + '…' : n.label}`
  if (n.kind === 'decision') return `${n.label}${n.status === 'blocked' ? ' · blocked' : ''}`
  return n.label.length > 46 ? n.label.slice(0, 44) + '…' : n.label
}

export class NetworkRenderer {
  private ctx: CanvasRenderingContext2D
  private graph: IntelGraph | null = null
  private target: Positions = new Map()
  private from: Positions = new Map()
  private shown: Positions = new Map()
  private animStart = 0
  private animDur = 0
  private frame = 0
  private palette: Palette
  view: ViewState = { lens: 'mission', selected: null, hover: null, keyFocus: null, focus: null, hidden: new Set(), failures: false, cursor: null }
  transform = { k: 1, x: 0, y: 0 }
  reducedMotion = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!
    this.palette = readPalette()
  }

  refreshPalette(): void { this.palette = readPalette(); this.requestDraw() }

  /** FORM: records that are new grow out of the record that introduced them. */
  setScene(graph: IntelGraph, pos: Positions, durationMs: number): void {
    const previous = this.shown
    this.graph = graph
    this.from = new Map()
    for (const id of pos.keys()) this.from.set(id, previous.get(id) ?? this.origin(id, pos))
    this.target = pos
    this.animate(durationMs)
  }

  /** EGO or its reverse: move to new positions without changing the scene. */
  moveTo(pos: Positions, durationMs: number): void {
    this.from = new Map(this.shown)
    this.target = pos
    this.animate(durationMs)
  }

  setView(patch: Partial<ViewState>): void { this.view = { ...this.view, ...patch }; this.requestDraw() }

  private origin(id: string, pos: Positions): Point {
    const parent = this.graph?.edges.find((e) => e.to === id && pos.has(e.from))
    const p = parent ? (this.shown.get(parent.from) ?? pos.get(parent.from)!) : { x: 0, y: 0 }
    return { x: p.x, y: p.y }
  }

  private animate(durationMs: number): void {
    const dur = this.reducedMotion ? 0 : durationMs
    if (!dur) { this.shown = new Map(this.target); this.requestDraw(); return }
    this.animStart = performance.now(); this.animDur = dur
    const step = (now: number) => {
      const t = Math.min(1, (now - this.animStart) / this.animDur)
      const e = 1 - Math.pow(1 - t, 3)
      const next: Positions = new Map()
      for (const [id, p] of this.target) { const f = this.from.get(id) ?? p; next.set(id, { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e }) }
      this.shown = next
      this.draw()
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  requestDraw(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw() })
  }

  fit(extraX = 0, extraY = 0): void {
    const rect = this.canvas.getBoundingClientRect()
    const pts = [...this.target.values()]
    if (!pts.length || !rect.width) return
    const lx = this.view.lens === 'mission' ? 210 + extraX : 60 + extraX
    const ly = this.view.lens === 'mission' ? 64 + extraY : 40 + extraY
    const minX = Math.min(...pts.map((p) => p.x)) - lx, maxX = Math.max(...pts.map((p) => p.x)) + lx
    const minY = Math.min(...pts.map((p) => p.y)) - ly, maxY = Math.max(...pts.map((p) => p.y)) + ly
    const k = Math.min((rect.width - 24) / Math.max(maxX - minX, 1), (rect.height - 24) / Math.max(maxY - minY, 1), 1.6)
    this.transform = { k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k }
    this.requestDraw()
  }

  centreOn(id: string): void {
    const rect = this.canvas.getBoundingClientRect(); const p = this.target.get(id); if (!p) return
    this.transform = { ...this.transform, x: rect.width / 2 - p.x * this.transform.k, y: rect.height / 2 - p.y * this.transform.k }
    this.requestDraw()
  }

  zoomAt(factor: number, mx?: number, my?: number): void {
    const rect = this.canvas.getBoundingClientRect()
    const x = mx ?? rect.width / 2, y = my ?? rect.height / 2
    const k = Math.max(0.25, Math.min(4, this.transform.k * factor))
    this.transform = { k, x: x - ((x - this.transform.x) * k) / this.transform.k, y: y - ((y - this.transform.y) * k) / this.transform.k }
    this.requestDraw()
  }

  pan(dx: number, dy: number): void { this.transform = { ...this.transform, x: this.transform.x + dx, y: this.transform.y + dy }; this.requestDraw() }

  toScreen(p: Point): Point { return { x: p.x * this.transform.k + this.transform.x, y: p.y * this.transform.k + this.transform.y } }

  visible(): IntelNode[] {
    if (!this.graph) return []
    return this.graph.nodes.filter((n) => !this.view.hidden.has(n.kind) && this.shown.has(n.id) && !(this.view.lens === 'mission' && n.kind === 'mission'))
  }

  hit(x: number, y: number): string | null {
    let best: string | null = null, bd = Infinity
    for (const n of this.visible()) { const p = this.toScreen(this.shown.get(n.id)!); const d = Math.hypot(p.x - x, p.y - y); if (d < this.size(n) + 8 && d < bd) { bd = d; best = n.id } }
    return best
  }

  /** Spatial keyboard navigation: the nearest node in the arrow's direction. */
  nearest(from: string | null, dx: number, dy: number): string | null {
    const nodes = this.visible()
    if (!nodes.length) return null
    if (!from || !this.shown.has(from)) return (nodes.find((n) => n.kind === 'stage') ?? nodes[0]!).id
    const cur = this.toScreen(this.shown.get(from)!)
    let best: string | null = null, bs = Infinity
    for (const n of nodes) {
      if (n.id === from) continue
      const p = this.toScreen(this.shown.get(n.id)!)
      const vx = p.x - cur.x, vy = p.y - cur.y, along = vx * dx + vy * dy
      if (along <= 2) continue
      const score = along + Math.abs(vx * dy - vy * dx) * 2.2
      if (score < bs) { bs = score; best = n.id }
    }
    return best ?? from
  }

  size(n: IntelNode): number {
    const lens = this.view.lens
    const base = n.kind === 'run' ? 5 + Math.sqrt(n.weight) * 1.3 : n.kind === 'file' ? 5 + Math.sqrt(n.weight) * 1.4 : n.kind === 'revision' ? 9 : n.kind === 'check' ? 6 : n.kind === 'finding' ? 6 + n.weight : n.kind === 'decision' ? 12 : n.kind === 'mission' ? (lens === 'mission' ? 4 : 10) : 6
    return Math.min(base, 22) * Math.max(0.75, Math.min(this.transform.k, 1.4))
  }

  private related(id: string): Set<string> {
    const s = new Set([id])
    for (const e of this.graph?.edges ?? []) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from) }
    return s
  }

  private hue(actor: string | null | undefined): string {
    const p = this.palette
    return actor === 'planner' ? p.planner : actor === 'implementer' ? p.builder : actor === 'reviewer' ? p.reviewer : actor === 'engine' ? p.engine : actor === 'human' ? p.you : p.ink2
  }

  draw(): void {
    const g = this.graph
    const ctx = this.ctx, P = this.palette, view = this.view
    const dpr = devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    if (this.canvas.width !== Math.round(rect.width * dpr) || this.canvas.height !== Math.round(rect.height * dpr)) { this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr) }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = P.void; ctx.fillRect(0, 0, rect.width, rect.height)
    if (!g) return
    const nodes = this.visible()
    const ids = new Set(nodes.map((n) => n.id))
    const anchor = view.keyFocus ?? view.hover ?? view.selected
    const lit = view.focus ? this.related(view.focus) : anchor ? this.related(anchor) : null
    const fails = view.failures ? new Set(nodes.filter((n) => n.status === 'failed' || n.status === 'blocked').flatMap((n) => [...this.related(n.id)])) : null
    const dimmed = (id: string) => (lit !== null && !lit.has(id)) || (fails !== null && !fails.has(id))
    const centre = this.toScreen({ x: 0, y: 0 })
    const clock = view.lens === 'mission' && !view.focus

    if (clock) {
      ctx.strokeStyle = P.rule; ctx.lineWidth = 1
      ctx.beginPath(); ctx.ellipse(centre.x, centre.y, RX * this.transform.k, RY * this.transform.k, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.ellipse(centre.x, centre.y, RX * 0.84 * this.transform.k, RY * 0.8 * this.transform.k, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
      const top = centre.y - RY * this.transform.k
      ctx.fillStyle = P.ink3; ctx.font = `500 10px ${P.mono}`; ctx.textAlign = 'right'
      ctx.fillText('TIME →', centre.x - 14, top + 18)
      ctx.strokeStyle = P.ink3; ctx.beginPath(); ctx.moveTo(centre.x, top - 6); ctx.lineTo(centre.x, top + 6); ctx.stroke()
    }

    // Edges: light on Night, ink on Day.
    ctx.globalCompositeOperation = P.night ? 'lighter' : 'source-over'
    for (const e of g.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue
      const a = this.toScreen(this.shown.get(e.from)!), b = this.toScreen(this.shown.get(e.to)!)
      const src = g.byId.get(e.from)!
      const focusId = view.focus ?? anchor
      const on = lit ? lit.has(e.from) && lit.has(e.to) && (e.from === focusId || e.to === focusId) : fails ? fails.has(e.from) && fails.has(e.to) : true
      const recent = view.cursor !== null && e.at !== null && view.cursor - e.at < 4000
      ctx.strokeStyle = e.kind === 'concerns' || (e.kind === 'tested' && src.status === 'failed') ? P.stop : e.kind === 'parent' || e.kind === 'decides' ? P.you : this.hue(src.actor)
      ctx.setLineDash(e.basis === 'derived' ? [6, 4] : e.basis === 'planned' ? [1.5, 4] : [])
      if (e.kind === 'sequence' && clock) {
        // HANDOFF: the ring between two stages lights in the colour of the stage that handed off.
        const a1 = Math.atan2((a.y - centre.y) / RY, (a.x - centre.x) / RX)
        let a2 = Math.atan2((b.y - centre.y) / RY, (b.x - centre.x) / RX)
        if (a2 < a1) a2 += Math.PI * 2
        ctx.lineWidth = lit && on ? 3 : 2; ctx.globalAlpha = on ? (lit ? 0.95 : P.night ? 0.55 : 0.75) : 0.06
        ctx.beginPath(); ctx.ellipse(centre.x, centre.y, RX * this.transform.k, RY * this.transform.k, 0, a1 + 0.08, a2 - 0.08); ctx.stroke()
        continue
      }
      ctx.globalAlpha = on ? (lit ? 0.85 : recent ? 0.75 : e.kind === 'sequence' ? 0.35 : P.night ? 0.2 : 0.32) : 0.04
      ctx.lineWidth = (e.kind === 'edit' ? 1.6 : e.kind === 'sequence' || e.kind === 'parent' ? 1.4 : 1) * (lit && on ? 1.4 : 1)
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx + (centre.x - mx) * 0.12, my + (centre.y - my) * 0.12, b.x, b.y); ctx.stroke()
    }
    ctx.setLineDash([]); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1

    // Nodes
    const t = performance.now()
    let breathing = false
    for (const n of nodes) {
      const p = this.toScreen(this.shown.get(n.id)!)
      const s = this.size(n)
      const dim = dimmed(n.id)
      ctx.globalAlpha = dim ? 0.12 : 1
      const col = this.hue(n.actor)
      // BREATHE only while a run or check is recorded as running.
      if (n.status === 'running' && !dim && n.kind !== 'mission' && !this.reducedMotion) {
        breathing = true
        const b = 0.5 + 0.5 * Math.sin(t / 650)
        ctx.fillStyle = col; ctx.globalAlpha = 0.12 + 0.12 * b
        ctx.beginPath(); ctx.arc(p.x, p.y, s + 8 + b * 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
      }
      this.glyph(n, p, s, col, centre, clock)
      if (n.id === view.selected || n.id === view.keyFocus) {
        ctx.strokeStyle = P.ink; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(p.x, p.y, s + 6, 0, Math.PI * 2); ctx.stroke()
        if (n.id === view.keyFocus) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, s + 10, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) }
      }
    }
    ctx.globalAlpha = 1
    this.labels(nodes, lit, dimmed, centre, clock)
    if (breathing) this.requestDraw()
  }

  private labels(nodes: IntelNode[], lit: Set<string> | null, dimmed: (id: string) => boolean, centre: Point, clock: boolean): void {
    const ctx = this.ctx, P = this.palette, view = this.view, g = this.graph!
    const placed: Array<[number, number, number, number]> = []
    for (const n of nodes) { if (dimmed(n.id)) continue; const p = this.toScreen(this.shown.get(n.id)!); const s = this.size(n); placed.push([p.x - s - 2, p.y - s - 2, s * 2 + 4, s * 2 + 4]) }
    const labelBoxes: Array<[number, number, number, number]> = []
    const hits = (list: Array<[number, number, number, number]>, b: [number, number, number, number]) => list.some((q) => b[0] < q[0] + q[2] && b[0] + b[2] > q[0] && b[1] < q[1] + q[3] && b[1] + b[3] > q[1])
    const order = [...nodes].sort((a, b) => ((lit?.has(a.id) ? 0 : 10) + KIND_PRIORITY[a.kind]) - ((lit?.has(b.id) ? 0 : 10) + KIND_PRIORITY[b.kind]) || b.weight - a.weight)
    const focusPoint = view.focus ? this.toScreen(this.shown.get(view.focus) ?? { x: 0, y: 0 }) : null
    for (const n of order) {
      if (dimmed(n.id)) continue
      const always = n.kind === 'stage' || n.kind === 'revision' || n.kind === 'decision' || n.kind === 'file' || n.kind === 'mission' || (lit?.has(n.id) ?? false)
      if (!always && this.transform.k < 1.2) continue
      const p = this.toScreen(this.shown.get(n.id)!)
      const s = this.size(n)
      const text = labelOf(n)
      const mono = n.kind === 'revision' || n.kind === 'file' || n.kind === 'check'
      ctx.font = mono ? `500 11px ${P.mono}` : n.kind === 'stage' ? `650 12px ${P.sans}` : `500 12px ${P.sans}`
      ;(ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = n.kind === 'stage' || n.kind === 'run' ? 'semi-condensed' : 'normal'
      const w = ctx.measureText(text).width
      let x = p.x + s + 7, y = p.y + 4
      if (n.kind === 'stage' && clock) { const dx = p.x - centre.x, dy = p.y - centre.y, d = Math.hypot(dx, dy) || 1; x = p.x + (dx / d) * 22 - (dx < 0 ? w : 0); y = p.y + (dy / d) * 22 + 4 }
      if (n.kind === 'revision' && !view.focus) { x = p.x - w / 2; y = p.y + s + 16 }
      const leftFirst = focusPoint !== null && n.id !== view.focus && p.x < focusPoint.x
      const right: [number, number] = [x, y], left: [number, number] = [p.x - s - 7 - w, y]
      const below: [number, number] = [p.x - w / 2, p.y + s + 15], above: [number, number] = [p.x - w / 2, p.y - s - 7]
      const slots: Array<[number, number]> = n.kind === 'stage' ? [[x, y]] : n.kind === 'revision' && !view.focus ? [below, above, right, left] : [...(leftFirst ? [left, right] : [right, left]), below, above]
      let chosen: [number, number] | null = null
      // Revision labels name the commits; they may cross a glyph but never another label.
      for (const [sx, sy] of slots) { const box: [number, number, number, number] = [sx - 3, sy - 12, w + 6, 17]; if (!hits(labelBoxes, box) && (n.kind === 'revision' || !hits(placed, box))) { chosen = [sx, sy]; placed.push(box); labelBoxes.push(box); break } }
      if (!chosen) continue
      ctx.fillStyle = n.kind === 'stage' ? this.hue(n.actor) : n.kind === 'finding' && n.status === 'blocked' ? P.stop : lit?.has(n.id) ? P.ink : P.ink2
      ctx.textAlign = 'left'; ctx.fillText(text, chosen[0], chosen[1])
      if (n.kind === 'stage') {
        ctx.font = `400 10px ${P.mono}`; ctx.fillStyle = n.status === 'failed' ? P.stop : P.ink3
        const word = n.status === 'running' ? 'RUNNING' : n.status === 'waiting' ? 'WAITING' : n.status === 'failed' ? 'FAILED' : n.status === 'ok' ? 'SUCCEEDED' : ''
        const off = n.at !== null ? `+${((n.at - g.start) / 1000).toFixed(1)}s` : ''
        ctx.fillText([word, off].filter(Boolean).join(' · '), chosen[0], chosen[1] + 14)
      }
    }
    ;(ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'normal'
  }

  private glyph(n: IntelNode, p: Point, s: number, col: string, centre: Point, clock: boolean): void {
    const ctx = this.ctx, P = this.palette
    ctx.lineWidth = 1.5
    const fail = n.status === 'failed'
    switch (n.kind) {
      case 'stage': {
        ctx.strokeStyle = fail ? P.stop : col; ctx.lineWidth = 3.5; ctx.lineCap = 'round'
        if (clock) { const ea = Math.atan2((p.y - centre.y) / RY, (p.x - centre.x) / RX); ctx.beginPath(); ctx.ellipse(centre.x, centre.y, RX * this.transform.k, RY * this.transform.k, 0, ea - 0.07, ea + 0.07); ctx.stroke() }
        else { ctx.beginPath(); ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y); ctx.stroke() }
        ctx.lineCap = 'butt'
        if (n.status === 'running' || n.status === 'waiting') { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill() }
        break
      }
      case 'run':
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill()
        if (fail) { ctx.strokeStyle = P.stop; ctx.lineWidth = 2; ctx.stroke() }
        break
      case 'file': {
        const f = n.file!
        ctx.strokeStyle = n.status === 'blocked' ? P.stop : P.ink2
        ctx.setLineDash(n.basis === 'planned' ? [1.5, 2.5] : [])
        if (f.diff) { ctx.fillStyle = P.ink; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s) } else { ctx.fillStyle = P.deck; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s) }
        ctx.setLineDash([])
        if (f.diff && f.diff.additions + f.diff.deletions > 0) {
          const total = f.diff.additions + f.diff.deletions, w = Math.max(s, 14)
          ctx.fillStyle = P.ink; ctx.fillRect(p.x - w / 2, p.y + s / 2 + 3, (w * f.diff.additions) / total, 2)
          ctx.fillStyle = P.ink3; ctx.fillRect(p.x - w / 2 + (w * f.diff.additions) / total, p.y + s / 2 + 3, (w * f.diff.deletions) / total, 2)
        }
        break
      }
      case 'revision': {
        const r = n.revision!
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y); ctx.closePath()
        if (r.role === 'head' || r.role === 'applied') { ctx.fillStyle = P.you; ctx.fill() } else { ctx.fillStyle = P.void; ctx.fill(); ctx.strokeStyle = P.you; ctx.stroke() }
        break
      }
      case 'check': {
        ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx.lineTo(p.x + Math.cos(a) * s, p.y + Math.sin(a) * s) } ctx.closePath()
        if (n.status === 'ok') { ctx.fillStyle = P.engine; ctx.fill() }
        else if (fail) { ctx.fillStyle = P.stop; ctx.fill(); ctx.strokeStyle = P.void; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(p.x - 2.5, p.y - 2.5); ctx.lineTo(p.x + 2.5, p.y + 2.5); ctx.moveTo(p.x + 2.5, p.y - 2.5); ctx.lineTo(p.x - 2.5, p.y + 2.5); ctx.stroke() }
        else { ctx.strokeStyle = P.engine; ctx.stroke() }
        break
      }
      case 'finding': {
        const sev = n.finding!.severity
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s * 0.9, p.y + s * 0.6); ctx.lineTo(p.x - s * 0.9, p.y + s * 0.6); ctx.closePath()
        if (sev === 'blocker') { ctx.fillStyle = P.stop; ctx.fill() } else { ctx.strokeStyle = sev === 'major' ? P.stop : sev === 'minor' ? P.engine : P.ink3; ctx.stroke() }
        break
      }
      case 'decision': {
        ctx.strokeStyle = n.status === 'blocked' ? P.stop : P.you; ctx.lineWidth = 1.6
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(p.x - s - 5, p.y); ctx.lineTo(p.x - s + 4, p.y); ctx.moveTo(p.x + s - 4, p.y); ctx.lineTo(p.x + s + 5, p.y)
        ctx.moveTo(p.x, p.y - s - 5); ctx.lineTo(p.x, p.y - s + 4); ctx.moveTo(p.x, p.y + s - 4); ctx.lineTo(p.x, p.y + s + 5)
        ctx.stroke()
        if (n.status === 'ok') { ctx.fillStyle = P.you; ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.45, 0, Math.PI * 2); ctx.fill() }
        break
      }
      case 'mission': {
        ctx.strokeStyle = n.status === 'failed' ? P.stop : n.status === 'waiting' ? P.you : P.ink2; ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.5, 0, Math.PI * 2); ctx.stroke()
        if (n.status === 'running' || n.status === 'waiting') { ctx.fillStyle = n.status === 'waiting' ? P.you : P.builder; ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.28, 0, Math.PI * 2); ctx.fill() }
        break
      }
    }
  }

  dispose(): void { if (this.frame) cancelAnimationFrame(this.frame) }
}
