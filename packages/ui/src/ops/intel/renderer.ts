/**
 * Canvas renderer for the evidence network. Immediate mode, redrawn only when something
 * changes (selection, hover, animation frame of a named move, a recorded run still running).
 * Colours come from the design tokens on <html>, so Night and Day are a token swap.
 * Chosen over SVG after measurement: ~8.8 ms vs ~15.8 ms main-thread per restyle frame and
 * 0.4 s vs 2.4 s setup at 10,000 nodes (design/prototypes/bench.html, TEST_EVIDENCE).
 */
import type { IntelEdge, IntelGraph, IntelKind, IntelNode } from './graph'
import { RX, RY, type Point, type Positions } from './layout'
import { tweenProgress } from './tween'

interface Tween { from: Point; start: number; dur: number }

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

const KIND_PRIORITY: Record<IntelKind, number> = { decision: 0, agent: 1, stage: 1, revision: 2, mission: 2, finding: 3, file: 4, run: 6, check: 7 }

export function labelOf(n: IntelNode): string {
  if (n.kind === 'file') return n.file!.path
  if (n.kind === 'revision') return `${n.revision!.short}${n.revision!.role === 'base' ? ' · base' : n.revision!.role === 'head' ? ' · head' : n.revision!.role === 'applied' ? ' · applied' : ''}`
  if (n.kind === 'check') return `${n.label} ${n.status === 'ok' ? '✓' : n.status === 'failed' ? '✕' : '…'}`
  if (n.kind === 'finding') return `${n.finding!.severity}: ${n.label.length > 42 ? n.label.slice(0, 40) + '…' : n.label}`
  if (n.kind === 'decision') return `${n.label}${n.status === 'blocked' ? ' · blocked' : n.status === 'waiting' ? ' · waiting' : n.status === 'idle' ? ' · not reached' : ''}`
  return n.label.length > 46 ? n.label.slice(0, 44) + '…' : n.label
}

export class NetworkRenderer {
  private ctx: CanvasRenderingContext2D
  private graph: IntelGraph | null = null
  private target: Positions = new Map()
  private shown: Positions = new Map()
  /** Per-mark tweens: a mark whose place is unchanged keeps its running tween when the scene is set again. */
  private tweens = new Map<string, Tween>()
  private animating = false
  private frame = 0
  private palette: Palette
  view: ViewState = { lens: 'mission', selected: null, hover: null, keyFocus: null, focus: null, hidden: new Set(), failures: false, cursor: null }
  /** Recorded events being shown as light: one pulse per edge event, one flash per node event. */
  private pulses: Array<{ edge: IntelEdge; t0: number; dur: number }> = []
  private flashes: Array<{ id: string; t0: number; dur: number }> = []
  /** check id → the revision it ran on; revision id → its checks. */
  private checkRev = new Map<string, string>()
  private revChecks = new Map<string, IntelNode[]>()
  private badges: Array<{ rev: string; x: number; y: number; r: number; w: number }> = []
  /** k = zoom; sx = extra horizontal stretch so the clock uses wide screens (fit only, never above 1.5). */
  transform = { k: 1, x: 0, y: 0, sx: 1 }
  private rx(): number { return RX * this.transform.k * this.transform.sx }
  private ry(): number { return RY * this.transform.k }
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
    this.checkRev = new Map(); this.revChecks = new Map()
    for (const e of graph.edges) if (e.kind === 'tested') { this.checkRev.set(e.from, e.to); const c = graph.byId.get(e.from); if (c) this.revChecks.set(e.to, [...(this.revChecks.get(e.to) ?? []), c]) }
    const now = performance.now(), before = this.target
    const tweens = new Map<string, Tween>()
    for (const [id, p] of pos) {
      const old = before.get(id), running = this.tweens.get(id)
      if (old && old.x === p.x && old.y === p.y) { if (running) tweens.set(id, running) }
      else tweens.set(id, { from: previous.get(id) ?? this.origin(id, pos), start: now, dur: durationMs })
    }
    this.tweens = tweens
    this.target = pos
    this.animate()
  }

  /** EGO or its reverse: move to new positions without changing the scene. */
  moveTo(pos: Positions, durationMs: number): void {
    const now = performance.now()
    this.tweens = new Map([...pos.keys()].map((id) => [id, { from: this.shown.get(id) ?? pos.get(id)!, start: now, dur: durationMs }]))
    this.target = pos
    this.animate()
  }

  setView(patch: Partial<ViewState>): void { this.view = { ...this.view, ...patch }; this.requestDraw() }

  private origin(id: string, pos: Positions): Point {
    const parent = this.graph?.edges.find((e) => e.to === id && pos.has(e.from))
    const p = parent ? (this.shown.get(parent.from) ?? pos.get(parent.from)!) : { x: 0, y: 0 }
    return { x: p.x, y: p.y }
  }

  private animate(): void {
    const place = (now: number): boolean => {
      const next: Positions = new Map()
      let moving = false
      for (const [id, p] of this.target) {
        const tw = this.tweens.get(id)
        if (!tw) { next.set(id, p); continue }
        const e = this.reducedMotion ? 1 : tweenProgress(now, tw.start, tw.dur)
        next.set(id, { x: tw.from.x + (p.x - tw.from.x) * e, y: tw.from.y + (p.y - tw.from.y) * e })
        if (e < 1) moving = true; else this.tweens.delete(id)
      }
      this.shown = next
      return moving
    }
    // One animation loop at a time; a new scene mid-flight only changes the tweens it reads.
    if (!place(performance.now())) { this.requestDraw(); return }
    if (this.animating) return
    this.animating = true
    const step = () => {
      const moving = place(performance.now())
      this.draw()
      if (moving) requestAnimationFrame(step); else this.animating = false
    }
    requestAnimationFrame(step)
  }

  requestDraw(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw() })
  }

  /** Positions the camera frames: the whole recorded layout, so replay and new records never zoom. */
  framing: Positions | null = null

  fit(extraX = 0, extraY = 0): void {
    const rect = this.canvas.getBoundingClientRect()
    const pts = [...(this.view.focus || !this.framing ? this.target : this.framing).values()]
    if (!pts.length || rect.width < 48 || rect.height < 48) return
    const lx = this.view.lens === 'mission' ? 210 + extraX : 220 + extraX
    const ly = this.view.lens === 'mission' ? 24 + extraY : 40 + extraY
    // Agent labels are two fixed-size screen lines above the top agent and below the bottom one.
    const padY = this.view.lens === 'mission' ? 52 : 12
    const minX = Math.min(...pts.map((p) => p.x)) - lx, maxX = Math.max(...pts.map((p) => p.x)) + lx
    const minY = Math.min(...pts.map((p) => p.y)) - ly, maxY = Math.max(...pts.map((p) => p.y)) + ly
    const kx = (rect.width - 24) / Math.max(maxX - minX, 1), ky = (rect.height - 24 - padY * 2) / Math.max(maxY - minY, 1)
    const k = Math.min(kx, ky, 1.6)
    if (!(k > 0.05)) return
    // A wide window stretches the clock sideways (up to 1.5×) instead of leaving empty margins.
    const sx = this.view.lens === 'mission' ? Math.max(1, Math.min(1.5, kx / k)) : 1
    this.transform = { k, sx, x: rect.width / 2 - ((minX + maxX) / 2) * k * sx, y: rect.height / 2 - ((minY + maxY) / 2) * k }
    this.requestDraw()
  }

  centreOn(id: string): void {
    const rect = this.canvas.getBoundingClientRect(); const p = this.target.get(id); if (!p) return
    this.transform = { ...this.transform, x: rect.width / 2 - p.x * this.transform.k * this.transform.sx, y: rect.height / 2 - p.y * this.transform.k }
    this.requestDraw()
  }

  zoomAt(factor: number, mx?: number, my?: number): void {
    const rect = this.canvas.getBoundingClientRect()
    const x = mx ?? rect.width / 2, y = my ?? rect.height / 2
    const k = Math.max(0.25, Math.min(4, this.transform.k * factor))
    this.transform = { k, sx: this.transform.sx, x: x - ((x - this.transform.x) * k) / this.transform.k, y: y - ((y - this.transform.y) * k) / this.transform.k }
    this.requestDraw()
  }

  pan(dx: number, dy: number): void { this.transform = { ...this.transform, x: this.transform.x + dx, y: this.transform.y + dy }; this.requestDraw() }

  toScreen(p: Point): Point { return { x: p.x * this.transform.k * this.transform.sx + this.transform.x, y: p.y * this.transform.k + this.transform.y } }

  visible(): IntelNode[] {
    if (!this.graph) return []
    return this.graph.nodes.filter((n) => !this.view.hidden.has(n.kind) && this.shown.has(n.id) && !(this.view.lens === 'mission' && n.kind === 'mission') && !(n.kind === 'check' && !this.checksOpen(n.id)))
  }

  /** Checks show one by one only near attention: their revision or a check is selected, hovered or focused, or the map is zoomed in. */
  private checksOpen(checkId: string): boolean {
    const rev = this.checkRev.get(checkId)
    if (!rev || this.transform.k >= 1.5 || this.view.focus) return true
    const v = this.view
    return [v.selected, v.hover, v.keyFocus].some((id) => id === rev || (id !== null && this.checkRev.get(id) === rev))
  }

  /** Read-only files (no edit, not in the diff, no finding) stay quiet until you look at them. */
  isQuiet(n: IntelNode): boolean {
    return n.kind === 'file' && this.view.lens === 'mission' && n.file!.edits === 0 && !n.file!.diff && n.file!.findings === 0
  }

  /** Light for recorded events: a pulse travels each edge once; nodes flash once. Reduced motion shows nothing extra. */
  play(edges: IntelEdge[], nodeIds: string[]): void {
    if (this.reducedMotion || (!edges.length && !nodeIds.length)) return
    const t0 = performance.now()
    edges.slice(-40).forEach((edge, i) => this.pulses.push({ edge, t0: t0 + Math.min(i, 8) * 40, dur: edge.kind === 'handoff' ? 900 : 620 }))
    for (const id of nodeIds.slice(-30)) this.flashes.push({ id, t0, dur: 700 })
    this.requestDraw()
  }

  hit(x: number, y: number): string | null {
    let best: string | null = null, bd = Infinity
    for (const n of this.visible()) { const p = this.toScreen(this.shown.get(n.id)!); const d = Math.hypot(p.x - x, p.y - y); if (d < this.size(n) + 8 && d < bd) { bd = d; best = n.id } }
    for (const b of this.badges) { const d = Math.hypot(b.x - x, b.y - y); if (d < b.r + 8 && d < bd) { bd = d; best = b.rev } }
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
    if (n.kind === 'agent') return 13 * Math.max(0.8, Math.min(this.transform.k, 1.3))
    if (this.isQuiet(n)) return 3.5 * Math.max(0.8, Math.min(this.transform.k, 1.4))
    const base = n.kind === 'run' ? 7 + Math.sqrt(n.weight) * 1.1 : n.kind === 'file' ? 5 + Math.sqrt(n.weight) * 1.4 : n.kind === 'revision' ? 9 : n.kind === 'check' ? 6 : n.kind === 'finding' ? 6 + n.weight : n.kind === 'decision' ? 12 : n.kind === 'mission' ? (lens === 'mission' ? 4 : 10) : 6
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
    if (rect.width < 2 || rect.height < 2 || this.transform.k <= 0) return
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
      ctx.beginPath(); ctx.ellipse(centre.x, centre.y, this.rx(), this.ry(), 0, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.ellipse(centre.x, centre.y, this.rx() * 0.84, this.ry() * 0.8, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
      const top = centre.y - this.ry()
      ctx.fillStyle = P.ink3; ctx.font = `500 10px ${P.mono}`; ctx.textAlign = 'right'
      ctx.fillText('TIME →', centre.x - 14, top + 18)
      ctx.strokeStyle = P.ink3; ctx.beginPath(); ctx.moveTo(centre.x, top - 6); ctx.lineTo(centre.x, top + 6); ctx.stroke()
    }

    // Edges: light on Night, ink on Day. At rest only the structure is drawn (stage ring, handoffs,
    // agents, revisions, edits, findings, your decision); everything else appears when you look at it.
    ctx.globalCompositeOperation = P.night ? 'lighter' : 'source-over'
    const focusId = view.focus ?? anchor
    const now = performance.now()
    const pulsing = new Set(this.pulses.filter((q) => now >= q.t0 && now < q.t0 + q.dur).map((q) => q.edge.id))
    for (const e of g.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) continue
      const a = this.toScreen(this.shown.get(e.from)!), b = this.toScreen(this.shown.get(e.to)!)
      const src = g.byId.get(e.from)!, dst = g.byId.get(e.to)!
      const on = lit ? lit.has(e.from) && lit.has(e.to) && (e.from === focusId || e.to === focusId || e.kind === 'handoff') : fails ? fails.has(e.from) && fails.has(e.to) : true
      const recent = view.cursor !== null && e.at !== null && view.cursor - e.at < 4000
      const hot = pulsing.has(e.id)
      ctx.strokeStyle = e.kind === 'concerns' || (e.kind === 'tested' && src.status === 'failed') ? P.stop : e.kind === 'parent' || e.kind === 'decides' ? P.you : this.hue(src.actor)
      ctx.setLineDash(e.basis === 'derived' ? [6, 4] : e.basis === 'planned' ? [1.5, 4] : [])
      if (e.kind === 'sequence' && clock) {
        // HANDOFF ring: the arc between two stages lights in the colour of the stage that handed off.
        const a1 = Math.atan2((a.y - centre.y) / this.ry(), (a.x - centre.x) / this.rx())
        let a2 = Math.atan2((b.y - centre.y) / this.ry(), (b.x - centre.x) / this.rx())
        if (a2 < a1) a2 += Math.PI * 2
        ctx.lineWidth = lit && on ? 3 : 2; ctx.globalAlpha = on ? (lit ? 0.95 : P.night ? 0.55 : 0.75) : 0.06
        ctx.beginPath(); ctx.ellipse(centre.x, centre.y, this.rx(), this.ry(), 0, a1 + 0.08, a2 - 0.08); ctx.stroke()
        continue
      }
      const atRest = this.restAlpha(e, dst)
      if (!lit && !fails && atRest === 0 && !hot && !recent) continue
      const c = this.control(e, a, b, centre)
      if (e.kind === 'handoff') {
        const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
        grad.addColorStop(0, this.hue(src.actor)); grad.addColorStop(1, this.hue(dst.actor))
        ctx.strokeStyle = grad
      }
      ctx.globalAlpha = hot ? 0.95 : on ? (lit ? 0.85 : recent ? 0.75 : atRest) : 0.04
      ctx.lineWidth = (e.kind === 'handoff' ? 2 : e.kind === 'edit' ? 1.4 : e.kind === 'parent' ? 1.4 : 1) * (lit && on ? 1.4 : 1) * (hot ? 1.5 : 1)
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke()
      if (e.kind === 'handoff' && ctx.globalAlpha > 0.1) this.arrow(a, c, b, this.size(dst) + 3)
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
    this.drawBadges(ids, dimmed)
    const live = this.drawLight(now, ids)
    this.labels(nodes, lit, dimmed, centre, clock)
    if (breathing || live) this.requestDraw()
  }

  /** How strongly an edge shows when nothing is selected (0 = only when you look). */
  private restAlpha(e: IntelEdge, dst: IntelNode): number {
    const night = this.palette.night
    switch (e.kind) {
      case 'handoff': return night ? 0.7 : 0.8
      case 'acts': return night ? 0.22 : 0.3
      case 'produced': case 'parent': case 'decides': return night ? 0.4 : 0.5
      case 'concerns': return 0.5
      case 'edit': return this.isQuiet(dst) ? 0 : night ? 0.2 : 0.3
      default: return this.view.lens === 'project' ? (night ? 0.2 : 0.32) : 0
    }
  }

  /** Control point: handoffs bow toward the centre so the relay reads inside the clock. */
  private control(e: IntelEdge, a: Point, b: Point, centre: Point): Point {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const pull = e.kind === 'handoff' ? 0.32 : 0.12
    return { x: mx + (centre.x - mx) * pull, y: my + (centre.y - my) * pull }
  }

  private arrow(a: Point, c: Point, b: Point, inset: number): void {
    const ctx = this.ctx
    const len = Math.hypot(b.x - c.x, b.y - c.y) || 1
    const t = Math.max(0.5, 1 - inset / Math.max(len * 2, 1))
    const px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y
    const tx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x), ty = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y)
    const d = Math.hypot(tx, ty) || 1, ux = tx / d, uy = ty / d
    ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle as string
    ctx.beginPath(); ctx.moveTo(px + ux * 5, py + uy * 5); ctx.lineTo(px - ux * 4 - uy * 4, py - uy * 4 + ux * 4); ctx.lineTo(px - ux * 4 + uy * 4, py - uy * 4 - ux * 4); ctx.closePath(); ctx.fill()
  }

  /** Collapsed checks: one badge per revision with pass/fail counts. */
  private drawBadges(ids: Set<string>, dimmed: (id: string) => boolean): void {
    const ctx = this.ctx, P = this.palette
    this.badges = []
    if (this.view.lens !== 'mission' || this.view.hidden.has('check')) return
    for (const [rev, checks] of this.revChecks) {
      if (!ids.has(rev) || this.checksOpen(checks[0]!.id)) continue
      const present = checks.filter((c) => this.shown.has(c.id) && this.graph!.byId.has(c.id))
      if (!present.length) continue
      const pts = present.map((c) => this.toScreen(this.shown.get(c.id)!))
      const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, y = Math.min(...pts.map((p) => p.y))
      const failed = present.filter((c) => c.status === 'failed').length, passed = present.filter((c) => c.status === 'ok').length, running = present.length - failed - passed
      const r = 6
      ctx.globalAlpha = dimmed(rev) ? 0.12 : 1
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) } ctx.closePath()
      ctx.fillStyle = failed ? P.stop : running ? P.void : P.engine; ctx.fill()
      if (running && !failed) { ctx.strokeStyle = P.engine; ctx.lineWidth = 1.4; ctx.stroke() }
      ctx.font = `500 10px ${P.mono}`; ctx.textAlign = 'left'; ctx.fillStyle = failed ? P.stop : P.ink2
      const count = [passed ? `${passed}✓` : '', failed ? `${failed}✕` : '', running ? `${running}…` : ''].filter(Boolean).join(' ')
      ctx.fillText(count, x + r + 4, y + 3.5)
      ctx.globalAlpha = 1
      this.badges.push({ rev, x, y, r, w: ctx.measureText(count).width })
    }
  }

  /** Pulses along edges and flashes on nodes for recorded events; returns true while any is in flight. */
  private drawLight(now: number, ids: Set<string>): boolean {
    const ctx = this.ctx, P = this.palette, g = this.graph!
    this.pulses = this.pulses.filter((q) => now < q.t0 + q.dur)
    this.flashes = this.flashes.filter((f) => now < f.t0 + f.dur)
    const centre = this.toScreen({ x: 0, y: 0 })
    ctx.globalCompositeOperation = P.night ? 'lighter' : 'source-over'
    for (const q of this.pulses) {
      if (now < q.t0 || !ids.has(q.edge.from) || !ids.has(q.edge.to)) continue
      const t = Math.min(1, (now - q.t0) / q.dur), e = 1 - Math.pow(1 - t, 2)
      const a = this.toScreen(this.shown.get(q.edge.from)!), b = this.toScreen(this.shown.get(q.edge.to)!), c = this.control(q.edge, a, b, centre)
      const x = (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * c.x + e * e * b.x, y = (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * c.y + e * e * b.y
      const col = q.edge.kind === 'concerns' ? P.stop : q.edge.kind === 'handoff' ? this.hue(g.byId.get(q.edge.to)?.actor) : this.hue(g.byId.get(q.edge.from)?.actor)
      ctx.fillStyle = col; ctx.globalAlpha = 0.25 * (1 - t * 0.5); ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1 - t * 0.3; ctx.beginPath(); ctx.arc(x, y, q.edge.kind === 'handoff' ? 4 : 3, 0, Math.PI * 2); ctx.fill()
    }
    for (const f of this.flashes) {
      const n = g.byId.get(f.id); if (!n || !ids.has(f.id)) continue
      const t = Math.min(1, Math.max(0, (now - f.t0) / f.dur)), p = this.toScreen(this.shown.get(f.id)!), s = this.size(n)
      ctx.strokeStyle = n.status === 'failed' || n.status === 'blocked' ? P.stop : this.hue(n.actor); ctx.lineWidth = 2
      ctx.globalAlpha = 1 - t; ctx.beginPath(); ctx.arc(p.x, p.y, s + 4 + t * 12, 0, Math.PI * 2); ctx.stroke()
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
    return this.pulses.length > 0 || this.flashes.length > 0
  }

  private labels(nodes: IntelNode[], lit: Set<string> | null, dimmed: (id: string) => boolean, centre: Point, clock: boolean): void {
    const ctx = this.ctx, P = this.palette, view = this.view, g = this.graph!
    const placed: Array<[number, number, number, number]> = []
    for (const n of nodes) { if (dimmed(n.id)) continue; const p = this.toScreen(this.shown.get(n.id)!); const s = this.size(n); placed.push([p.x - s - 2, p.y - s - 2, s * 2 + 4, s * 2 + 4]) }
    // Check badges are drawn first; labels keep clear of them.
    const labelBoxes: Array<[number, number, number, number]> = this.badges.map((b) => [b.x - b.r - 1, b.y - b.r - 1, b.r * 2 + b.w + 8, b.r * 2 + 2])
    const bounds = this.canvas.getBoundingClientRect()
    const hits = (list: Array<[number, number, number, number]>, b: [number, number, number, number]) => list.some((q) => b[0] < q[0] + q[2] && b[0] + b[2] > q[0] && b[1] < q[1] + q[3] && b[1] + b[3] > q[1])
    // Handoff labels: what the engine passed from one agent's run to the next.
    if (this.view.lens === 'mission' && !view.focus) {
      const ids = new Set(nodes.map((n) => n.id))
      ctx.font = `500 10px ${P.mono}`
      for (const e of g.edges) {
        if (e.kind !== 'handoff' || !e.label || !ids.has(e.from) || !ids.has(e.to) || dimmed(e.from) || dimmed(e.to)) continue
        const a = this.toScreen(this.shown.get(e.from)!), b = this.toScreen(this.shown.get(e.to)!), c = this.control(e, a, b, centre)
        const mx = 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, my = 0.25 * a.y + 0.5 * c.y + 0.25 * b.y
        const w = ctx.measureText(e.label).width
        const box: [number, number, number, number] = [mx - w / 2 - 4, my - 8, w + 8, 15]
        if (hits(labelBoxes, box) || hits(placed, box)) continue
        ctx.fillStyle = P.void; ctx.globalAlpha = 0.85; ctx.fillRect(box[0], box[1], box[2], box[3]); ctx.globalAlpha = 1
        ctx.fillStyle = P.ink2; ctx.textAlign = 'center'; ctx.fillText(e.label, mx, my + 3.5); ctx.textAlign = 'left'
        labelBoxes.push(box); placed.push(box)
      }
    }
    const order = [...nodes].sort((a, b) => ((lit?.has(a.id) ? 0 : 10) + KIND_PRIORITY[a.kind]) - ((lit?.has(b.id) ? 0 : 10) + KIND_PRIORITY[b.kind]) || b.weight - a.weight)
    const focusPoint = view.focus ? this.toScreen(this.shown.get(view.focus) ?? { x: 0, y: 0 }) : null
    for (const n of order) {
      if (dimmed(n.id)) continue
      const always = n.kind === 'stage' || n.kind === 'agent' || n.kind === 'revision' || n.kind === 'decision' || (n.kind === 'file' && !this.isQuiet(n)) || n.kind === 'mission' || (lit?.has(n.id) ?? false)
      if (!always && this.transform.k < 1.5) continue
      const p = this.toScreen(this.shown.get(n.id)!)
      const s = this.size(n)
      const text = labelOf(n)
      const mono = n.kind === 'revision' || n.kind === 'file' || n.kind === 'check'
      ctx.font = mono ? `500 11px ${P.mono}` : n.kind === 'stage' ? `650 12px ${P.sans}` : `500 12px ${P.sans}`
      ;(ctx as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = n.kind === 'stage' || n.kind === 'run' ? 'semi-condensed' : 'normal'
      const w = ctx.measureText(text).width
      let x = p.x + s + 7, y = p.y + 4
      if (n.kind === 'agent') {
        const dx = p.x - centre.x, dy = p.y - centre.y, d = Math.hypot(dx, dy) || 1
        x = p.x + (dx / d) * (s + 10) - (dx < -d * 0.3 ? w : dx > d * 0.3 ? 0 : w / 2); y = p.y + (dy / d) * (s + 10) + (dy > 0 ? 10 : -10)
      }
      if (n.kind === 'stage' && clock) { const dx = p.x - centre.x, dy = p.y - centre.y, d = Math.hypot(dx, dy) || 1; x = p.x + (dx / d) * 22 - (dx < 0 ? w : 0); y = p.y + (dy / d) * 22 + 4 }
      if (n.kind === 'revision' && !view.focus) { x = p.x - w / 2; y = p.y + s + 16 }
      const leftFirst = focusPoint !== null && n.id !== view.focus && p.x < focusPoint.x
      const right: [number, number] = [x, y], left: [number, number] = [p.x - s - 7 - w, y]
      const below: [number, number] = [p.x - w / 2, p.y + s + 15], above: [number, number] = [p.x - w / 2, p.y - s - 7]
      const slots: Array<[number, number]> = n.kind === 'stage' || n.kind === 'agent' ? [[x, y]] : n.kind === 'revision' && !view.focus ? [below, above, right, left, [below[0], below[1] + 14], [above[0], above[1] - 14]] : [...(leftFirst ? [left, right] : [right, left]), below, above]
      let chosen: [number, number] | null = null
      // Revision labels name the commits; they may cross a glyph but never another label.
      for (const [sx, sy] of slots) { const box: [number, number, number, number] = [sx - 3, sy - 12, w + 6, 17]; if (box[0] >= 2 && box[0] + box[2] <= bounds.width - 2 && !hits(labelBoxes, box) && (n.kind === 'revision' || !hits(placed, box))) { chosen = [sx, sy]; placed.push(box); labelBoxes.push(box); break } }
      if (!chosen) continue
      ctx.fillStyle = n.kind === 'stage' || n.kind === 'agent' ? this.hue(n.actor) : n.kind === 'finding' && n.status === 'blocked' ? P.stop : lit?.has(n.id) ? P.ink : P.ink2
      ctx.textAlign = 'left'; ctx.fillText(text, chosen[0], chosen[1])
      if (n.kind === 'agent') {
        const ag = n.agent!
        ctx.font = `400 10px ${P.mono}`; ctx.fillStyle = P.ink3
        ctx.fillText(`${ag.runs.length} run${ag.runs.length === 1 ? '' : 's'} · ${ag.toolCalls} call${ag.toolCalls === 1 ? '' : 's'}${n.status === 'running' ? ' · RUNNING' : ''}`, chosen[0], chosen[1] + 14)
      }
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
        if (clock) { const ea = Math.atan2((p.y - centre.y) / this.ry(), (p.x - centre.x) / this.rx()); ctx.beginPath(); ctx.ellipse(centre.x, centre.y, this.rx(), this.ry(), 0, ea - 0.07, ea + 0.07); ctx.stroke() }
        else { ctx.beginPath(); ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y); ctx.stroke() }
        ctx.lineCap = 'butt'
        if (n.status === 'running' || n.status === 'waiting') { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill() }
        break
      }
      case 'run':
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill()
        if (fail) { ctx.strokeStyle = P.stop; ctx.lineWidth = 2; ctx.stroke() }
        if (s >= 7) this.monogram(n, p, s, P.void)
        break
      case 'agent': {
        // An agent is a role on a provider: role hue ring, role initial, provider mark below the ring.
        const a = n.agent!
        ctx.save(); ctx.globalAlpha *= 0.16; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill(); ctx.restore()
        ctx.strokeStyle = fail ? P.stop : col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.stroke()
        this.monogram(n, p, s, col)
        // Provider mark: Claude Code = filled dot, Codex CLI = open square, others = open dot.
        const mx = p.x + s * 0.72, my = p.y + s * 0.72
        ctx.fillStyle = P.void; ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.4
        if (a.provider === 'claude') { ctx.beginPath(); ctx.arc(mx, my, 2.6, 0, Math.PI * 2); ctx.fill() }
        else if (a.provider === 'codex') ctx.strokeRect(mx - 2.5, my - 2.5, 5, 5)
        else { ctx.beginPath(); ctx.arc(mx, my, 2.6, 0, Math.PI * 2); ctx.stroke() }
        break
      }
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

  private monogram(n: IntelNode, p: Point, s: number, color: string): void {
    const ctx = this.ctx
    const letter = n.actor === 'planner' ? 'P' : n.actor === 'implementer' ? 'I' : n.actor === 'reviewer' ? 'R' : ''
    if (!letter) return
    ctx.fillStyle = color; ctx.font = `700 ${Math.round(Math.max(9, s * 0.95))}px ${this.palette.sans}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(letter, p.x, p.y + 0.5)
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  }

  dispose(): void { if (this.frame) cancelAnimationFrame(this.frame) }
}
