/**
 * Deterministic layouts for the evidence network (design/DESIGN-SYSTEM.md, "The network").
 * Same input, same picture: no random seeds, no perpetual simulation. Positions are in a
 * world space centred on 0,0; the renderer fits them to the canvas.
 */
import type { IntelEdge, IntelGraph, IntelNode } from './graph'

export interface Point { x: number; y: number }
export type Positions = Map<string, Point>

/** Mission clock radii: wide ellipse, so a laptop screen is used edge to edge. */
export const RX = 640
export const RY = 400

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function layoutMission(g: IntelGraph): Positions {
  const pos: Positions = new Map()
  const stages = g.nodes.filter((n) => n.kind === 'stage')
  // Twelve o'clock is where recorded time starts; stages run clockwise in recorded order.
  stages.forEach((s, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(stages.length, 1) + 0.0001
    pos.set(s.id, { x: Math.cos(a) * RX, y: Math.sin(a) * RY })
    const runs = g.edges.filter((e) => e.from === s.id && e.kind === 'performs').map((e) => e.to)
    runs.forEach((rid, j) => {
      const spread = (j - (runs.length - 1) / 2) * 0.12
      pos.set(rid, { x: Math.cos(a + spread) * RX * 0.84, y: Math.sin(a + spread) * RY * 0.8 })
    })
  })
  // Runs not placed by a stage record (should not happen; never drop a record).
  g.nodes.filter((n) => n.kind === 'run' && !pos.has(n.id)).forEach((n, i) => pos.set(n.id, { x: -RX * 0.6 + i * 40, y: RY * 0.7 }))

  // The revision spine across the centre, in recorded order.
  const revs = g.nodes.filter((n) => n.kind === 'revision').sort((a, b) => a.revision!.index - b.revision!.index)
  const w = Math.min(560, 230 * Math.max(revs.length - 1, 1))
  revs.forEach((r, i) => pos.set(r.id, { x: revs.length === 1 ? 0 : -w / 2 + (w * i) / (revs.length - 1), y: -40 }))

  // Checks fan over the top of the revision they ran on.
  const byRev = new Map<string, IntelNode[]>()
  for (const e of g.edges) if (e.kind === 'tested') { const list = byRev.get(e.to) ?? []; const n = g.byId.get(e.from); if (n) list.push(n); byRev.set(e.to, list) }
  for (const [rid, checks] of byRev) {
    const c = pos.get(rid); if (!c) continue
    checks.forEach((ch, i) => { const a = Math.PI + (Math.PI * (i + 0.5)) / checks.length; const r = checks.length > 8 ? 46 : 36; pos.set(ch.id, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }) })
  }
  g.nodes.filter((n) => n.kind === 'check' && !pos.has(n.id)).forEach((n, i) => pos.set(n.id, { x: -80 + i * 16, y: -110 }))

  const head = revs.at(-1)
  if (g.byId.has('decision')) pos.set('decision', head ? { x: pos.get(head.id)!.x + 110, y: pos.get(head.id)!.y + 10 } : { x: 0, y: 120 })
  pos.set('mission', { x: 0, y: 0 })

  placeFiles(g, pos, revs.map((r) => pos.get(r.id)!).concat([...byRev.values()].flat().map((c) => pos.get(c.id)!).filter(Boolean)))

  // Findings sit in a short column left of their file; never on its label.
  const stacks = new Map<string, number>()
  for (const e of g.edges) if (e.kind === 'concerns') {
    const f = pos.get(e.to); if (!f) continue
    const i = stacks.get(e.to) ?? 0; stacks.set(e.to, i + 1)
    pos.set(e.from, { x: f.x - 26 - i * 18, y: f.y })
  }
  for (const n of g.nodes) if (n.kind === 'finding' && !pos.has(n.id)) {
    const raised = g.edges.find((e) => e.kind === 'raised' && e.to === n.id)
    const r = raised ? pos.get(raised.from) : null
    pos.set(n.id, r ? { x: r.x * 0.8, y: r.y * 0.8 } : { x: 0, y: RY * 0.5 })
  }
  return pos
}

/** Files settle in the inner field, pulled by the runs that edited (strongly) or read them. */
function placeFiles(g: IntelGraph, pos: Positions, fixed: Point[]): void {
  const files = g.nodes.filter((n) => n.kind === 'file')
  if (!files.length) return
  for (const n of files) { const h = hash(n.id); pos.set(n.id, { x: ((h % 1000) / 1000 - 0.5) * 520, y: 60 + (((h >> 10) % 1000) / 1000) * 180 }) }
  const ids = new Set(files.map((f) => f.id))
  const springs = g.edges.filter((e) => ids.has(e.to) && e.from !== 'mission' && pos.has(e.from))
  const strength: Record<string, number> = { edit: 0.05, read: 0.012, changed: 0.03 }
  const ideal: Record<string, number> = { edit: 140, read: 220, changed: 120 }
  const iterations = files.length > 120 ? 120 : 300
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / (iterations * 1.1)
    for (const e of springs) {
      const a = pos.get(e.from)!, b = pos.get(e.to)!
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1
      const f = (d - (ideal[e.kind] ?? 160)) * (strength[e.kind] ?? 0.01) * cool
      b.x -= (dx / d) * f; b.y -= (dy / d) * f
    }
    const pts = files.map((f) => pos.get(f.id)!)
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!
      for (let j = i + 1; j < pts.length; j++) {
        const q = pts[j]!; const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01
        if (d2 < 170 * 170) { const d = Math.sqrt(d2), f = (4200 / d2) * cool; p.x -= (dx / d) * f; p.y -= (dy / d) * f; q.x += (dx / d) * f; q.y += (dy / d) * f }
      }
      for (const q of fixed) { const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01; if (d2 < 110 * 110) { const d = Math.sqrt(d2), f = (5200 / d2) * cool; p.x -= (dx / d) * f; p.y -= (dy / d) * f } }
      const ex = p.x / (RX * 0.66), ey = p.y / (RY * 0.62), er = Math.hypot(ex, ey)
      if (er > 1) { p.x /= er; p.y /= er }
    }
  }
}

/** Ego layout for focus (F): what fed the node on the left, what it produced on the right. */
export function egoLayout(g: IntelGraph, base: Positions, id: string): Positions {
  const next = new Map(base)
  const ins = new Map<string, IntelNode>(), outs = new Map<string, IntelNode>()
  for (const e of g.edges) {
    if (e.to === id && g.byId.has(e.from)) ins.set(e.from, g.byId.get(e.from)!)
    if (e.from === id && g.byId.has(e.to) && !ins.has(e.to)) outs.set(e.to, g.byId.get(e.to)!)
  }
  const order = (list: IntelNode[]) => list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const column = (list: IntelNode[], x: number) => list.forEach((n, i) => next.set(n.id, { x, y: (i - (list.length - 1) / 2) * Math.min(64, 520 / Math.max(list.length, 1)) }))
  next.set(id, { x: 0, y: 0 })
  column(order([...ins.values()]), -300)
  column(order([...outs.values()]), 300)
  return next
}

export interface ProjectEntry { id: string; label: string; node: IntelNode; files: Array<{ path: string; kind: 'edit' | 'read' | 'planned' }> }

/** Project lens: mission cores on a ring, linked only through files they recorded touching (or planned to). */
export function layoutProject(entries: ProjectEntry[]): { nodes: IntelNode[]; edges: IntelEdge[]; pos: Positions } {
  const nodes: IntelNode[] = []; const edges: IntelEdge[] = []; const pos: Positions = new Map()
  const files = new Map<string, IntelNode>()
  const radius = Math.max(300, entries.length * 34)
  entries.forEach((m, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(entries.length, 1)
    nodes.push(m.node)
    pos.set(m.id, { x: Math.cos(a) * radius * 1.4, y: Math.sin(a) * radius })
    for (const f of m.files) {
      const fid = `file:${f.path}`
      if (!files.has(fid)) {
        const n: IntelNode = { id: fid, kind: 'file', label: f.path.split('/').pop() ?? f.path, detail: f.path, basis: f.kind === 'planned' ? 'planned' : 'observed', status: 'idle', actor: null, at: null, end: null, weight: 1, file: { path: f.path, planned: f.kind === 'planned', reads: 0, edits: 0, diff: null, findings: 0, touchedBy: [] } }
        files.set(fid, n); nodes.push(n)
      }
      const n = files.get(fid)!
      if (f.kind === 'edit') { n.file!.edits++; n.weight += 2 } else if (f.kind === 'read') { n.file!.reads++; n.weight += 1 }
      if (f.kind !== 'planned') n.basis = 'observed'
      edges.push({ id: `${m.id}>${fid}`, from: m.id, to: fid, kind: f.kind === 'planned' ? 'planned' : f.kind, basis: f.kind === 'planned' ? 'planned' : 'observed', at: null })
    }
  })
  for (const f of files.values()) { const h = hash(f.id); pos.set(f.id, { x: ((h % 1000) / 1000 - 0.5) * 220, y: (((h >> 10) % 1000) / 1000 - 0.5) * 220 }) }
  const fileList = [...files.values()]
  for (let it = 0; it < 220; it++) {
    for (const e of edges) { const a = pos.get(e.from)!, b = pos.get(e.to)!; const k = e.kind === 'edit' ? 0.05 : e.kind === 'read' ? 0.025 : 0.01; b.x += (a.x - b.x) * k * 0.5; b.y += (a.y - b.y) * k * 0.5 }
    for (let i = 0; i < fileList.length; i++) for (let j = i + 1; j < fileList.length; j++) {
      const p = pos.get(fileList[i]!.id)!, q = pos.get(fileList[j]!.id)!
      const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01
      if (d2 < 9000) { const d = Math.sqrt(d2), f = 900 / d2; p.x -= (dx / d) * f; p.y -= (dy / d) * f; q.x += (dx / d) * f; q.y += (dy / d) * f }
    }
  }
  return { nodes, edges, pos }
}
