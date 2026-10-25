/**
 * Concept A — Neural Command Network.
 * A settled, deterministic map of one mission's evidence: stage attempts around a clock ring
 * (time runs clockwise from twelve), the revision chain across the centre, files pulled toward
 * the agents that touched them, checks orbiting the exact revision they tested, findings pinned
 * to their files. Canvas 2D for the picture; HTML for every control, the inspector and a full
 * list alternative.
 */
import { projectAt, type IntelGraph, type IntelNode, type IntelEdge, type IntelKind } from '../../../packages/ui/src/ops/intel/graph'
import { loadPack, el, renderInspector, fixtureBanner, neighbours, fmtOffset, KIND_NAME, SCENARIO_NAME, statusWord, rng, type LoadedMission } from './shared'

type Lens = 'mission' | 'project' | 'stress'
interface P { x: number; y: number }
interface Scene { g: IntelGraph; pos: Map<string, P>; simulated: boolean; title: string }

const C = {
  void: '#07090c', deck: '#0d1117', guide: '#161d26', ink: '#e8ecf1', ink2: '#9ba6b4', ink3: '#5c6776',
  planner: '#74b9ff', implementer: '#ffb24a', reviewer: '#3fd0c4', engine: '#a9b6c6', human: '#f4efe3', stop: '#ff5b52'
}
const hue = (actor: string | null | undefined) => (actor && (C as any)[actor]) || C.ink2
const reduced = matchMedia('(prefers-reduced-motion: reduce)')

// ---------- Layout ----------
const RX = 640, RY = 400
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }

function layoutMission(g: IntelGraph): Map<string, P> {
  const pos = new Map<string, P>()
  const stages = g.nodes.filter((n) => n.kind === 'stage')
  const span = Math.PI * 2
  const a0 = -Math.PI / 2
  stages.forEach((s, i) => {
    const a = a0 + (span * i) / Math.max(stages.length, 1) + 0.0001
    pos.set(s.id, { x: Math.cos(a) * RX, y: Math.sin(a) * RY })
    const runs = g.edges.filter((e) => e.from === s.id && e.kind === 'performs').map((e) => e.to)
    runs.forEach((rid, j) => {
      const spread = (j - (runs.length - 1) / 2) * 0.12
      pos.set(rid, { x: Math.cos(a + spread) * RX * 0.84, y: Math.sin(a + spread) * RY * 0.8 })
    })
  })
  // Revision chain across the centre, in recorded order.
  const revs = g.nodes.filter((n) => n.kind === 'revision').sort((a, b) => a.revision!.index - b.revision!.index)
  const w = Math.min(560, 230 * Math.max(revs.length - 1, 1))
  revs.forEach((r, i) => pos.set(r.id, { x: revs.length === 1 ? 0 : -w / 2 + (w * i) / (revs.length - 1), y: -40 }))
  // Checks orbit the revision they tested, failures toward the top.
  const byRev = new Map<string, IntelNode[]>()
  for (const e of g.edges) if (e.kind === 'tested') { const list = byRev.get(e.to) ?? []; list.push(g.byId.get(e.from)!); byRev.set(e.to, list) }
  for (const [rid, checks] of byRev) {
    const c = pos.get(rid)!
    // Checks fan over the top of their revision, oldest left; the label sits below the diamond.
    checks.forEach((ch, i) => { const a = Math.PI + (Math.PI * (i + 0.5)) / checks.length; pos.set(ch.id, { x: c.x + Math.cos(a) * 36, y: c.y + Math.sin(a) * 36 }) })
  }
  const head = revs.at(-1)
  if (g.byId.has('decision')) pos.set('decision', head ? { x: pos.get(head.id)!.x + 110, y: pos.get(head.id)!.y + 10 } : { x: 0, y: 120 })
  pos.set('mission', { x: 0, y: 0 })

  // Files and findings: a short deterministic force pass, anchors fixed.
  const free = g.nodes.filter((n) => n.kind === 'file' || n.kind === 'finding')
  for (const n of free) { const h = hash(n.id); pos.set(n.id, { x: ((h % 1000) / 1000 - 0.5) * 520, y: 60 + (((h >> 10) % 1000) / 1000) * 180 }) }
  const springs = g.edges.filter((e) => (free.some((f) => f.id === e.from) || free.some((f) => f.id === e.to)) && e.from !== 'mission')
  const strength: Record<string, number> = { edit: 0.05, read: 0.012, concerns: 0.09, raised: 0.01, changed: 0.03, planned: 0.004 }
  const ideal: Record<string, number> = { edit: 140, read: 220, concerns: 30, raised: 200, changed: 120, planned: 260 }
  for (let it = 0; it < 360; it++) {
    const cool = 1 - it / 400
    for (const e of springs) {
      const a = pos.get(e.from), b = pos.get(e.to)
      if (!a || !b) continue
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1
      const f = (d - (ideal[e.kind] ?? 160)) * (strength[e.kind] ?? 0.01) * cool
      const fromFree = free.some((n) => n.id === e.from), toFree = free.some((n) => n.id === e.to)
      if (fromFree) { a.x += (dx / d) * f; a.y += (dy / d) * f }
      if (toFree) { b.x -= (dx / d) * f; b.y -= (dy / d) * f }
    }
    // Repel from each other and from the revision spine; stay inside the ring.
    const all = [...free.map((n) => pos.get(n.id)!)]
    const fixed = [...revs.map((r) => pos.get(r.id)!), ...[...byRev.values()].flat().map((c) => pos.get(c.id)!)]
    for (let i = 0; i < all.length; i++) {
      const p = all[i]!
      for (let j = i + 1; j < all.length; j++) { const q = all[j]!; const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01; if (d2 < 170 * 170) { const f = (4200 / d2) * cool; const d = Math.sqrt(d2); p.x -= (dx / d) * f; p.y -= (dy / d) * f; q.x += (dx / d) * f; q.y += (dy / d) * f } }
      for (const q of fixed) { const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01; if (d2 < 110 * 110) { const d = Math.sqrt(d2); const f = (5200 / d2) * cool; p.x -= (dx / d) * f; p.y -= (dy / d) * f } }
      // Keep the field inside the inner ellipse.
      const ex = p.x / (RX * 0.66), ey = p.y / (RY * 0.62), er = Math.hypot(ex, ey); if (er > 1) { p.x /= er; p.y /= er }
    }
  }
  // Findings sit in a short column to the left of the file they concern, never on its label.
  const stacks = new Map<string, number>()
  for (const e of g.edges) if (e.kind === 'concerns') {
    const f = pos.get(e.to); if (!f) continue
    const i = stacks.get(e.to) ?? 0; stacks.set(e.to, i + 1)
    pos.set(e.from, { x: f.x - 26 - i * 18, y: f.y })
  }
  for (const n of g.nodes) if (n.kind === 'finding' && !g.edges.some((e) => e.kind === 'concerns' && e.from === n.id)) { const rv = g.edges.find((e) => e.kind === 'raised' && e.to === n.id); const r = rv ? pos.get(rv.from) : null; if (r) pos.set(n.id, { x: r.x * 0.8, y: r.y * 0.8 }) }
  return pos
}

/** Project lens: every mission of the project as a cluster, linked through the files they share. */
function projectScene(missions: LoadedMission[], projectId: string): Scene {
  const ms = missions.filter((m) => m.project.id === projectId)
  const nodes: IntelNode[] = []
  const edges: IntelEdge[] = []
  const pos = new Map<string, P>()
  const files = new Map<string, IntelNode>()
  ms.forEach((m, i) => {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / ms.length
    const mid = `m:${m.graph.task.id}`
    const core: IntelNode = { ...m.graph.byId.get('mission')!, id: mid, label: m.title, weight: 4 }
    nodes.push(core); pos.set(mid, { x: Math.cos(a) * 360, y: Math.sin(a) * 360 })
    for (const f of m.graph.nodes.filter((n) => n.kind === 'file')) {
      const fid = `file:${f.file!.path}`
      if (!files.has(fid)) { const copy: IntelNode = { ...f, id: fid, file: { ...f.file!, reads: 0, edits: 0, findings: 0, touchedBy: [] }, weight: 1 }; files.set(fid, copy); nodes.push(copy) }
      const shared = files.get(fid)!
      shared.file!.reads += f.file!.reads; shared.file!.edits += f.file!.edits; shared.weight += f.file!.edits * 2 + f.file!.reads
      const kind = f.file!.edits ? 'edit' : f.file!.reads ? 'read' : 'planned'
      edges.push({ id: `${mid}>${fid}`, from: mid, to: fid, kind, basis: kind === 'planned' ? 'planned' : 'observed', at: f.at })
    }
  })
  for (const f of files.values()) { const h = hash(f.id); pos.set(f.id, { x: ((h % 1000) / 1000 - 0.5) * 200, y: (((h >> 10) % 1000) / 1000 - 0.5) * 200 }) }
  for (let it = 0; it < 300; it++) {
    for (const e of edges) { const a = pos.get(e.from)!, b = pos.get(e.to)!; const dx = a.x - b.x, dy = a.y - b.y; const k = e.kind === 'edit' ? 0.06 : e.kind === 'read' ? 0.03 : 0.01; b.x += dx * k * 0.5; b.y += dy * k * 0.5 }
    const fs = [...files.values()].map((f) => pos.get(f.id)!)
    for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) { const p = fs[i]!, q = fs[j]!; const dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy + 0.01; if (d2 < 9000) { const d = Math.sqrt(d2), f = 900 / d2; p.x -= dx / d * f; p.y -= dy / d * f; q.x += dx / d * f; q.y += dy / d * f } }
  }
  const g = ms[0]!.graph
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const counts = { mission: ms.length, stage: 0, run: 0, file: files.size, revision: 0, check: 0, finding: 0, decision: 0 } as Record<IntelKind, number>
  return { g: { ...g, nodes, edges, byId, counts, moments: [], gaps: ['Project lens: each mission is collapsed to its core; files link missions that touched the same path.'] }, pos, simulated: false, title: `${ms[0]!.project.name} · ${ms.length} missions` }
}

/** Labelled density simulation for performance and readability testing. Never real activity. */
function stressScene(missionCount: number): Scene {
  const r = rng(7)
  const nodes: IntelNode[] = []; const edges: IntelEdge[] = []; const pos = new Map<string, P>()
  const pool = Array.from({ length: Math.round(missionCount * 2.2) }, (_, i) => `src/${['api', 'core', 'ui', 'lib', 'test'][i % 5]}/module-${i}.ts`)
  const fileIds = new Map<string, IntelNode>()
  const base = { basis: 'observed' as const, status: 'idle' as const, at: 0, end: null, detail: 'SIMULATED' }
  for (let m = 0; m < missionCount; m++) {
    const id = `sim:m${m}`; const a = (m / missionCount) * Math.PI * 2
    nodes.push({ ...base, id, kind: 'mission', label: `Simulated mission ${m + 1}`, actor: 'human', weight: 3, status: r() < 0.12 ? 'failed' : 'ok' })
    pos.set(id, { x: Math.cos(a) * 900, y: Math.sin(a) * 900 })
    const touched = 3 + Math.floor(r() * 9)
    const centre = Math.floor(r() * pool.length)
    for (let k = 0; k < touched; k++) {
      const path = pool[(centre + Math.floor((r() - 0.5) * 30) + pool.length) % pool.length]!
      const fid = `sim:${path}`
      if (!fileIds.has(fid)) { const n: IntelNode = { ...base, id: fid, kind: 'file', label: path.split('/').pop()!, actor: null, weight: 1, file: { path, planned: false, reads: 0, edits: 0, diff: null, findings: 0, touchedBy: [] } }; fileIds.set(fid, n); nodes.push(n); pos.set(fid, { x: (r() - 0.5) * 1200, y: (r() - 0.5) * 1200 }) }
      const kind = r() < 0.45 ? 'edit' : 'read'
      fileIds.get(fid)!.weight += kind === 'edit' ? 2 : 1
      edges.push({ id: `${id}>${fid}>${k}`, from: id, to: fid, kind, basis: 'observed', at: 0 })
    }
  }
  for (let it = 0; it < 80; it++) for (const e of edges) { const a = pos.get(e.from)!, b = pos.get(e.to)!; b.x += (a.x - b.x) * 0.02; b.y += (a.y - b.y) * 0.02 }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const counts = { mission: missionCount, stage: 0, run: 0, file: fileIds.size, revision: 0, check: 0, finding: 0, decision: 0 } as Record<IntelKind, number>
  const g = { task: { title: 'SIMULATED density study', prompt: 'Generated locally to test rendering and readability. Not Hydra activity.' } as any, nodes, edges, byId, start: 0, end: 0, moments: [], live: false, counts, gaps: ['SIMULATED: generated missions and files for a density test. Nothing here happened.'] }
  return { g, pos, simulated: true, title: `SIMULATED density · ${missionCount} missions · ${nodes.length} nodes · ${edges.length} links` }
}

// ---------- App ----------
async function main() {
  const { pack, missions } = await loadPack()
  const root = document.getElementById('app')!
  let mi = 0
  let lens: Lens = 'mission'
  let scene: Scene = sceneFor()
  let view: IntelGraph = scene.g
  let cursor: number | null = null
  let selected: string | null = null
  let hover: string | null = null
  let keyFocus: string | null = null
  let focusMode: string | null = null
  let showFailures = false
  const hidden = new Set<IntelKind>()
  let stressCount = 120
  // Animated positions
  let shown = new Map<string, P>()
  let target = new Map<string, P>()
  let from = new Map<string, P>()
  let animStart = 0, animDur = 0
  let transform = { k: 1, x: 0, y: 0 }

  function sceneFor(): Scene {
    if (lens === 'project') return projectScene(missions, missions[mi]!.project.id)
    if (lens === 'stress') return stressScene(stressCount)
    const g = missions[mi]!.graph
    return { g, pos: layoutMission(g), simulated: false, title: missions[mi]!.title }
  }

  // DOM
  const canvas = el('canvas', { class: 'net', tabindex: '0', role: 'application', 'aria-label': 'Mission evidence map. Arrow keys move between items, Enter inspects, F focuses, Escape steps back, slash searches.', 'aria-describedby': 'a11y-live' })
  const live = el('div', { id: 'a11y-live', class: 'sr-only', 'aria-live': 'polite' })
  const inspector = el('aside', { class: 'inspector', 'aria-label': 'Evidence inspector' })
  const channels = el('div', { class: 'channels', role: 'toolbar', 'aria-label': 'Show or hide entity types' })
  const titleEl = el('h1', { class: 'm-title' })
  const subEl = el('p', { class: 'm-sub' })
  const missionPicker = el('select', { id: 'mission', 'aria-label': 'Mission' }, ...missions.map((m, i) => el('option', { value: String(i) }, `${SCENARIO_NAME[m.scenario] ?? m.scenario} — ${m.title}`)))
  const lensTabs = el('div', { class: 'lens', role: 'tablist', 'aria-label': 'Scope' })
  const search = el('input', { id: 'find', type: 'search', placeholder: 'Find a file, check, finding…', 'aria-label': 'Find on the map', autocomplete: 'off' })
  const results = el('ul', { class: 'results', role: 'listbox', hidden: true })
  const listView = el('div', { class: 'listview', hidden: true })
  const listToggle = el('button', { class: 'btn btn-quiet', 'aria-pressed': 'false' }, 'List view')
  const failToggle = el('button', { class: 'btn btn-quiet', 'aria-pressed': 'false', title: 'Light up failed checks, blocking findings and blocked decisions' }, 'Show failures')
  const fitBtn = el('button', { class: 'btn btn-quiet', title: 'Fit the map (0)' }, 'Fit')
  const play = el('button', { class: 'btn', 'aria-label': 'Replay recorded moments' }, 'Replay')
  const scrub = el('input', { id: 'scrub', type: 'range', min: '0', max: '1000', value: '1000', 'aria-label': 'Replay position' })
  const scrubText = el('span', { class: 'scrub-text mono' }, 'Live end')
  const ticks = el('canvas', { class: 'ticks', 'aria-hidden': 'true' })
  const focusBar = el('div', { class: 'focusbar', hidden: true })

  ;(['mission', 'project', 'stress'] as Lens[]).forEach((l) => lensTabs.append(el('button', { role: 'tab', 'aria-selected': String(l === lens), 'data-lens': l, onclick: () => setLens(l) }, l === 'mission' ? 'Mission' : l === 'project' ? 'Project' : 'Density test')))

  root.append(
    fixtureBanner(pack),
    el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('b', {}, 'Hydra'), el('span', { class: 'mono dim' }, 'A · Neural command network')),
      el('div', { class: 'picker' }, missionPicker, lensTabs),
      el('div', { class: 'find' }, search, results)),
    el('main', { class: 'stage' },
      el('section', { class: 'mapwrap', 'aria-label': 'Evidence map' },
        el('div', { class: 'maphead' }, el('div', {}, titleEl, subEl), el('div', { class: 'tools' }, failToggle, fitBtn, listToggle)),
        channels, focusBar, canvas, listView,
        el('div', { class: 'replay' }, play, el('div', { class: 'scrubwrap' }, ticks, scrub), scrubText)),
      inspector),
    live)

  const ctx = canvas.getContext('2d')!
  const tctx = ticks.getContext('2d')!

  function setLens(l: Lens) {
    lens = l
    lensTabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.lens === l)))
    missionPicker.disabled = l === 'stress'
    rebuild(true)
  }

  function rebuild(fit: boolean) {
    scene = sceneFor(); cursor = null; selected = null; focusMode = null; hover = null; keyFocus = null
    scrub.value = '1000'; scrub.disabled = lens !== 'mission'; play.disabled = lens !== 'mission'
    view = scene.g
    animateTo(new Map(scene.pos), reduced.matches ? 0 : 420, true)
    if (fit) fitView()
    titleEl.textContent = scene.title
    subEl.textContent = lens === 'mission' ? `${scene.g.task.intent === 'analyze' ? 'Question' : 'Change'} · ${scene.g.task.status.replace('_', ' ')}${scene.g.task.waitReason ? ' · ' + scene.g.task.waitReason.replace('_', ' ') : ''} · ${missions[mi]!.project.name}` : lens === 'project' ? 'Missions are linked only through files they recorded touching' : 'SIMULATED — generated to test density. Not Hydra activity.'
    root.classList.toggle('is-sim', scene.simulated)
    renderChannels(); renderInspectorPanel(); renderList(); drawTicks(); draw()
  }

  function animateTo(next: Map<string, P>, dur: number, fresh = false) {
    from = new Map(); for (const id of next.keys()) from.set(id, fresh ? centreOf(id, next) : shown.get(id) ?? centreOf(id, next))
    target = next; animStart = performance.now(); animDur = dur
    if (!dur) { shown = new Map(next); draw(); return }
    requestAnimationFrame(tick)
  }
  // FORM: new nodes grow out of the item that introduced them.
  function centreOf(id: string, next: Map<string, P>): P {
    const parent = view.edges.find((e) => e.to === id && next.has(e.from))
    const p = parent ? next.get(parent.from)! : { x: 0, y: 0 }
    return { x: p.x, y: p.y }
  }
  function tick(now: number) {
    const t = Math.min(1, (now - animStart) / animDur)
    const e = 1 - Math.pow(1 - t, 3)
    shown = new Map(); for (const [id, p] of target) { const f = from.get(id) ?? p; shown.set(id, { x: f.x + (p.x - f.x) * e, y: f.y + (p.y - f.y) * e }) }
    draw()
    if (t < 1) requestAnimationFrame(tick)
  }

  function fitView() {
    const rect = canvas.getBoundingClientRect()
    const pts = [...scene.pos.values()]
    if (!pts.length) return
    // Leave room for the outward stage labels on the mission clock.
    const lx = lens === 'mission' ? 210 : 40, ly = lens === 'mission' ? 40 : 30
    const minX = Math.min(...pts.map((p) => p.x)) - lx, maxX = Math.max(...pts.map((p) => p.x)) + lx, minY = Math.min(...pts.map((p) => p.y)) - ly, maxY = Math.max(...pts.map((p) => p.y)) + ly
    const pad = 24
    const k = Math.min((rect.width - pad * 2) / Math.max(maxX - minX, 1), (rect.height - pad * 2) / Math.max(maxY - minY, 1), 1.6)
    transform = { k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k }
  }
  const toScreen = (p: P) => ({ x: p.x * transform.k + transform.x, y: p.y * transform.k + transform.y })

  // ---------- Drawing ----------
  function visibleNodes() { return view.nodes.filter((n) => !hidden.has(n.kind) && shown.has(n.id) && !(lens === 'mission' && n.kind === 'mission')) }
  function sizeOf(n: IntelNode) {
    const base = n.kind === 'run' ? 5 + Math.sqrt(n.weight) * 1.3 : n.kind === 'file' ? 5 + Math.sqrt(n.weight) * 1.4 : n.kind === 'revision' ? 9 : n.kind === 'check' ? 6 : n.kind === 'finding' ? 6 + n.weight : n.kind === 'decision' ? 12 : n.kind === 'mission' ? (lens === 'mission' ? 4 : 10) : 6
    return Math.min(base, 22) * Math.max(0.75, Math.min(transform.k, 1.4))
  }
  function related(id: string) { const s = new Set([id]); for (const e of view.edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from) } return s }
  function failing(n: IntelNode) { return n.status === 'failed' || n.status === 'blocked' }

  function draw() {
    const dpr = devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr) }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = C.void; ctx.fillRect(0, 0, rect.width, rect.height)
    const nodes = visibleNodes()
    const ids = new Set(nodes.map((n) => n.id))
    const anchor = keyFocus ?? hover ?? selected
    const lit = focusMode ? related(focusMode) : anchor ? related(anchor) : null
    const fails = showFailures ? new Set(nodes.filter(failing).flatMap((n) => [...related(n.id)])) : null
    const dimmed = (id: string) => (lit && !lit.has(id)) || (fails && !fails.has(id))

    // Guides: the clock ring and the revision spine (mission lens only)
    if (lens === 'mission' && !focusMode) {
      const c = toScreen({ x: 0, y: 0 })
      ctx.strokeStyle = C.guide; ctx.lineWidth = 1
      ctx.beginPath(); ctx.ellipse(c.x, c.y, RX * transform.k, RY * transform.k, 0, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([2, 6]); ctx.beginPath(); ctx.ellipse(c.x, c.y, RX * 0.84 * transform.k, RY * 0.8 * transform.k, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
      // Twelve o'clock: where recorded time starts. A small arrow says which way it runs.
      const top = c.y - RY * transform.k
      ctx.fillStyle = C.ink3; ctx.font = `500 10px ${MONO}`; ctx.textAlign = 'right'
      ctx.fillText('TIME →', c.x - 16, top - 10)
      ctx.strokeStyle = C.ink3; ctx.beginPath(); ctx.moveTo(c.x, top - 6); ctx.lineTo(c.x, top + 6); ctx.stroke()
    }

    // Edges
    ctx.globalCompositeOperation = 'lighter'
    for (const e of view.edges) {
      if (!ids.has(e.from) || !ids.has(e.to) || e.kind === 'performs' && lens !== 'mission') continue
      const a = toScreen(shown.get(e.from)!), b = toScreen(shown.get(e.to)!)
      const src = view.byId.get(e.from)!
      const on = lit ? lit.has(e.from) && lit.has(e.to) && (e.from === (focusMode ?? anchor) || e.to === (focusMode ?? anchor)) : fails ? fails.has(e.from) && fails.has(e.to) : true
      const recent = cursor !== null && e.at !== null && cursor - e.at < 4000
      ctx.strokeStyle = e.kind === 'concerns' || (e.kind === 'tested' && src.status === 'failed') ? C.stop : e.kind === 'parent' || e.kind === 'decides' ? C.human : hue(src.actor)
      ctx.globalAlpha = on ? (lit ? 0.85 : recent ? 0.7 : e.kind === 'sequence' ? 0.35 : 0.2) : 0.04
      ctx.lineWidth = (e.kind === 'edit' ? 1.6 : e.kind === 'sequence' || e.kind === 'parent' ? 1.4 : 1) * (lit && on ? 1.4 : 1)
      ctx.setLineDash(e.basis === 'derived' ? [6, 4] : e.basis === 'planned' ? [1.5, 4] : [])
      if (e.kind === 'sequence' && lens === 'mission' && !focusMode) {
        // Handoff: the ring between two consecutive stages lights in the colour of the stage that handed off.
        const c = toScreen({ x: 0, y: 0 })
        const a1 = Math.atan2((a.y - c.y) / RY, (a.x - c.x) / RX)
        let a2 = Math.atan2((b.y - c.y) / RY, (b.x - c.x) / RX)
        if (a2 < a1) a2 += Math.PI * 2
        ctx.lineWidth = lit && on ? 3 : 2; ctx.globalAlpha = on ? (lit ? 0.95 : 0.55) : 0.06
        ctx.beginPath(); ctx.ellipse(c.x, c.y, RX * transform.k, RY * transform.k, 0, a1 + 0.08, a2 - 0.08); ctx.stroke()
        continue
      }
      ctx.beginPath(); ctx.moveTo(a.x, a.y)
      { const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; const c = toScreen({ x: 0, y: 0 }); ctx.quadraticCurveTo(mx + (c.x - mx) * 0.12, my + (c.y - my) * 0.12, b.x, b.y) }
      ctx.stroke()
    }
    ctx.setLineDash([]); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1

    // Nodes
    const t = performance.now()
    let breathing = false
    for (const n of nodes) {
      const p = toScreen(shown.get(n.id)!)
      const s = sizeOf(n)
      const dim = dimmed(n.id)
      ctx.globalAlpha = dim ? 0.12 : 1
      const col = hue(n.actor)
      if (n.status === 'running' && !reduced.matches && !dim) { breathing = true; const b = 0.5 + 0.5 * Math.sin(t / 650); ctx.fillStyle = col; ctx.globalAlpha = 0.12 + 0.12 * b; ctx.beginPath(); ctx.arc(p.x, p.y, s + 8 + b * 4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1 }
      drawGlyph(n, p, s, col)
      if (n.id === selected || n.id === keyFocus) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, s + 6, 0, Math.PI * 2); ctx.stroke(); if (n.id === keyFocus) { ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, s + 10, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]) } }
    }
    ctx.globalAlpha = 1

    // Labels with greedy collision avoidance; neighbourhood labels win.
    const placed: Array<[number, number, number, number]> = []
    // Glyphs reserve their own space first, so labels never sit on top of a mark.
    for (const n of nodes) { if (dimmed(n.id)) continue; const p = toScreen(shown.get(n.id)!); const s = sizeOf(n); placed.push([p.x - s - 2, p.y - s - 2, s * 2 + 4, s * 2 + 4]) }
    const overlaps = (box: [number, number, number, number]) => placed.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])
    const prio = (n: IntelNode) => (lit?.has(n.id) ? 0 : 1) * 10 + ({ decision: 0, stage: 1, revision: 2, mission: 2, finding: 3, file: 4, run: 6, check: 7 } as any)[n.kind]
    const order = [...nodes].sort((a, b) => prio(a) - prio(b) || b.weight - a.weight)
    for (const n of order) {
      if (dimmed(n.id)) continue
      const always = n.kind === 'stage' || n.kind === 'revision' || n.kind === 'decision' || n.kind === 'file' || n.kind === 'mission' || (lit?.has(n.id) ?? false)
      if (!always && transform.k < 1.2) continue
      const p = toScreen(shown.get(n.id)!)
      const s = sizeOf(n)
      const text = labelOf(n)
      const mono = n.kind === 'revision' || n.kind === 'file' || n.kind === 'check'
      ctx.font = mono ? `500 11px ${MONO}` : n.kind === 'stage' ? `650 12px ${SANS}` : `500 12px ${SANS}`
      ;(ctx as any).fontStretch = n.kind === 'stage' ? 'semi-condensed' : 'normal'
      const w = ctx.measureText(text).width
      let x = p.x + s + 7, y = p.y + 4
      if (n.kind === 'revision') { x = p.x - w / 2; y = p.y + s + 16 }
      if (n.kind === 'stage' && lens === 'mission' && !focusMode) { const c = toScreen({ x: 0, y: 0 }); const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1; x = p.x + (dx / d) * 22 - (dx < 0 ? w : 0); y = p.y + (dy / d) * 22 + 4 }
      // Try right, left, below, above; skip the label only if every slot is taken.
      const leftFirst = focusMode !== null && n.id !== focusMode && p.x < toScreen(shown.get(focusMode) ?? { x: 0, y: 0 }).x
      const right: [number, number] = [x, y], left: [number, number] = [p.x - s - 7 - w, y]
      const slots: Array<[number, number]> = n.kind === 'stage' || (n.kind === 'revision' && !focusMode) ? [[x, y]] : [...(leftFirst ? [left, right] : [right, left]), [p.x - w / 2, p.y + s + 15], [p.x - w / 2, p.y - s - 7]]
      let chosen: [number, number] | null = null
      for (const [sx, sy] of slots) { const box: [number, number, number, number] = [sx - 3, sy - 12, w + 6, 17]; if (!overlaps(box)) { chosen = [sx, sy]; placed.push(box); break } }
      if (!chosen) continue
      x = chosen[0]; y = chosen[1]
      ctx.fillStyle = n.kind === 'stage' ? hue(n.actor) : n.kind === 'finding' && n.status === 'blocked' ? C.stop : lit?.has(n.id) ? C.ink : C.ink2
      ctx.textAlign = 'left'; ctx.fillText(text, x, y)
      if (n.kind === 'stage') { ctx.font = `400 10px ${MONO}`; ctx.fillStyle = n.status === 'failed' ? C.stop : C.ink3; ctx.fillText(stageSub(n), x, y + 14) }
    }
    ;(ctx as any).fontStretch = 'normal'
    if (breathing) requestAnimationFrame(() => draw())
  }

  function stageSub(n: IntelNode) { const word = statusWord(n); return `${word ? word.toUpperCase() : ''}${n.at !== null && lens === 'mission' ? ' · ' + fmtOffset(n.at, view.start) : ''}` }
  function labelOf(n: IntelNode) {
    if (n.kind === 'file') return n.file!.path
    if (n.kind === 'revision') return `${n.revision!.short}${n.revision!.role === 'base' ? ' · base' : n.revision!.role === 'head' ? ' · head' : n.revision!.role === 'applied' ? ' · applied' : ''}`
    if (n.kind === 'run') return n.label
    if (n.kind === 'check') return `${n.label} ${n.status === 'ok' ? '✓' : n.status === 'failed' ? '✕' : '…'}`
    if (n.kind === 'finding') return `${n.finding!.severity}: ${n.label.length > 42 ? n.label.slice(0, 40) + '…' : n.label}`
    if (n.kind === 'decision') return `${n.label}${n.status === 'blocked' ? ' · blocked' : ''}`
    return n.label.length > 46 ? n.label.slice(0, 44) + '…' : n.label
  }

  function drawGlyph(n: IntelNode, p: P, s: number, col: string) {
    ctx.lineWidth = 1.5
    const fail = n.status === 'failed'
    switch (n.kind) {
      case 'stage': {
        const c = toScreen({ x: 0, y: 0 })
        ctx.strokeStyle = fail ? C.stop : col; ctx.lineWidth = 3.5; ctx.lineCap = 'round'
        if (lens === 'mission' && !focusMode) { const ea = Math.atan2((p.y - c.y) / RY, (p.x - c.x) / RX); ctx.beginPath(); ctx.ellipse(c.x, c.y, RX * transform.k, RY * transform.k, 0, ea - 0.07, ea + 0.07); ctx.stroke() } else { ctx.beginPath(); ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y); ctx.stroke() }
        ctx.lineCap = 'butt'
        if (n.status === 'running' || n.status === 'waiting') { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill() }
        break
      }
      case 'run': ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.fill(); if (fail) { ctx.strokeStyle = C.stop; ctx.lineWidth = 2; ctx.stroke() } break
      case 'file': {
        const f = n.file!
        ctx.strokeStyle = f.findings && n.status === 'blocked' ? C.stop : C.ink2
        ctx.setLineDash(n.basis === 'planned' ? [1.5, 2.5] : [])
        if (f.diff) { ctx.fillStyle = C.ink; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s) } else { ctx.fillStyle = C.deck; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); ctx.strokeRect(p.x - s / 2, p.y - s / 2, s, s) }
        ctx.setLineDash([])
        if (f.diff && (f.diff.additions + f.diff.deletions) > 0) { const total = f.diff.additions + f.diff.deletions; const w = Math.max(s, 14); ctx.fillStyle = C.ink; ctx.fillRect(p.x - w / 2, p.y + s / 2 + 3, (w * f.diff.additions) / total, 2); ctx.fillStyle = C.ink3; ctx.fillRect(p.x - w / 2 + (w * f.diff.additions) / total, p.y + s / 2 + 3, (w * f.diff.deletions) / total, 2) }
        break
      }
      case 'revision': {
        const r = n.revision!
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s, p.y); ctx.closePath()
        if (r.role === 'head' || r.role === 'applied') { ctx.fillStyle = C.human; ctx.fill() } else { ctx.fillStyle = C.void; ctx.fill(); ctx.strokeStyle = C.human; ctx.stroke() }
        break
      }
      case 'check': {
        ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; ctx.lineTo(p.x + Math.cos(a) * s, p.y + Math.sin(a) * s) } ctx.closePath()
        if (n.status === 'ok') { ctx.fillStyle = C.engine; ctx.fill() } else if (fail) { ctx.fillStyle = C.stop; ctx.fill(); ctx.strokeStyle = C.void; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(p.x - 2.5, p.y - 2.5); ctx.lineTo(p.x + 2.5, p.y + 2.5); ctx.moveTo(p.x + 2.5, p.y - 2.5); ctx.lineTo(p.x - 2.5, p.y + 2.5); ctx.stroke() } else { ctx.strokeStyle = C.engine; ctx.stroke() }
        break
      }
      case 'finding': {
        const sev = n.finding!.severity
        ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s * 0.9, p.y + s * 0.6); ctx.lineTo(p.x - s * 0.9, p.y + s * 0.6); ctx.closePath()
        if (sev === 'blocker') { ctx.fillStyle = C.stop; ctx.fill() } else { ctx.strokeStyle = sev === 'major' ? C.stop : sev === 'minor' ? C.engine : C.ink3; ctx.stroke() }
        break
      }
      case 'decision': {
        const blocked = n.status === 'blocked'
        ctx.strokeStyle = blocked ? C.stop : C.human; ctx.lineWidth = 1.6
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(p.x - s - 5, p.y); ctx.lineTo(p.x - s + 4, p.y); ctx.moveTo(p.x + s - 4, p.y); ctx.lineTo(p.x + s + 5, p.y); ctx.moveTo(p.x, p.y - s - 5); ctx.lineTo(p.x, p.y - s + 4); ctx.moveTo(p.x, p.y + s - 4); ctx.lineTo(p.x, p.y + s + 5); ctx.stroke()
        if (n.status === 'ok') { ctx.fillStyle = C.human; ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.45, 0, Math.PI * 2); ctx.fill() }
        break
      }
      case 'mission': {
        ctx.strokeStyle = n.status === 'failed' ? C.stop : C.human; ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.5, 0, Math.PI * 2); ctx.stroke()
        break
      }
    }
  }

  function drawTicks() {
    const dpr = devicePixelRatio || 1
    const rect = ticks.getBoundingClientRect()
    ticks.width = Math.round(rect.width * dpr); ticks.height = Math.round(rect.height * dpr)
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0); tctx.clearRect(0, 0, rect.width, rect.height)
    if (lens !== 'mission') return
    const g = scene.g; const span = Math.max(1, g.end - g.start)
    for (const n of g.nodes) {
      if (n.at === null || n.kind === 'mission') continue
      const x = ((n.at - g.start) / span) * rect.width
      tctx.fillStyle = n.status === 'failed' || n.status === 'blocked' ? C.stop : hue(n.actor)
      const h = n.kind === 'stage' ? rect.height : n.kind === 'run' ? rect.height * 0.7 : rect.height * 0.4
      tctx.globalAlpha = 0.8; tctx.fillRect(x, rect.height - h, 1.5, h)
    }
    tctx.globalAlpha = 1
  }

  // ---------- Panels ----------
  function renderChannels() {
    channels.replaceChildren()
    const kinds: IntelKind[] = lens === 'mission' ? ['stage', 'run', 'file', 'revision', 'check', 'finding', 'decision'] : ['mission', 'file']
    for (const k of kinds) {
      const count = view.nodes.filter((n) => n.kind === k).length
      const b = el('button', { class: `chan chan-${k}`, 'aria-pressed': String(!hidden.has(k)), onclick: () => { if (hidden.has(k)) hidden.delete(k); else hidden.add(k); renderChannels(); draw() } }, el('span', { class: `glyph g-${k}`, 'aria-hidden': 'true' }), `${KIND_NAME[k]}${k === 'check' || k === 'finding' || k === 'file' || k === 'run' || k === 'stage' || k === 'mission' ? 's' : ''}`, el('span', { class: 'num' }, String(count)))
      channels.append(b)
    }
    channels.append(el('span', { class: 'basis-key' }, el('i', { class: 'k-obs' }), 'observed', el('i', { class: 'k-der' }), 'derived', el('i', { class: 'k-pla' }), 'planned'))
  }

  function renderInspectorPanel() {
    const n = selected ? view.byId.get(selected) ?? null : null
    const content = lens === 'mission' || n ? renderInspector(view, n, { onSelect: select }) : el('div', { class: 'insp insp-empty' }, el('p', { class: 'insp-eyebrow' }, lens === 'project' ? 'Project lens' : 'Density test'), el('h2', { class: 'insp-title' }, scene.title), ...scene.g.gaps.map((x) => el('p', { class: 'insp-hint' }, x)))
    if (n && lens === 'mission') content.prepend(el('div', { class: 'insp-focus' }, el('button', { class: 'btn btn-quiet', onclick: () => toggleFocus(n.id) }, focusMode === n.id ? 'Leave focus (Esc)' : 'Focus on this (F)')))
    inspector.replaceChildren(content)
    inspector.classList.remove('reveal'); void inspector.offsetWidth; if (!reduced.matches) inspector.classList.add('reveal')
  }

  function renderList() {
    listView.replaceChildren()
    const groups: IntelKind[] = ['decision', 'stage', 'run', 'revision', 'check', 'finding', 'file', 'mission']
    for (const k of groups) {
      const items = view.nodes.filter((n) => n.kind === k && !(lens === 'mission' && k === 'mission'))
      if (!items.length) continue
      listView.append(el('h3', {}, `${KIND_NAME[k]} (${items.length})`), el('ul', {}, ...items.map((n) => el('li', {}, el('button', { class: 'linkish', onclick: () => select(n.id) }, labelOf(n)), ' ', el('span', { class: 'dim' }, [statusWord(n), n.basis !== 'observed' ? n.basis : ''].filter(Boolean).join(' · '))))))
    }
  }

  function announce(n: IntelNode | null) {
    if (!n) return
    const { ins, outs } = neighbours(view, n.id)
    live.textContent = `${KIND_NAME[n.kind]}: ${labelOf(n)}. ${statusWord(n) ?? ''}. ${ins.length + outs.length} connections. Enter to inspect.`
  }

  function select(id: string | null) {
    selected = id; keyFocus = id
    renderInspectorPanel(); draw()
    if (id) announce(view.byId.get(id) ?? null)
  }

  // ISOLATE + ego layout: what fed it on the left, what it produced on the right.
  function toggleFocus(id: string) {
    if (focusMode === id) { focusMode = null; focusBar.hidden = true; animateTo(new Map(projectedPos()), reduced.matches ? 0 : 360); renderInspectorPanel(); return }
    focusMode = id
    const { ins, outs } = neighbours(view, id)
    const next = new Map(projectedPos())
    const c = { x: 0, y: 0 }
    next.set(id, c)
    const col = (list: IntelNode[], x: number) => list.forEach((n, i) => next.set(n.id, { x, y: (i - (list.length - 1) / 2) * Math.min(64, 520 / Math.max(list.length, 1)) }))
    const uniq = (xs: Array<{ node: IntelNode }>) => [...new Map(xs.map((x) => [x.node.id, x.node])).values()]
    col(uniq(ins), -300); col(uniq(outs).filter((n) => !ins.some((i) => i.node.id === n.id)), 300)
    animateTo(next, reduced.matches ? 0 : 360)
    const n = view.byId.get(id)!
    focusBar.hidden = false
    focusBar.replaceChildren(el('span', {}, el('b', {}, 'Focus: '), labelOf(n), el('span', { class: 'dim' }, `  ·  ${ins.length} in  ·  ${outs.length} out`)), el('button', { class: 'btn btn-quiet', onclick: () => toggleFocus(id) }, 'Leave focus'))
    // center camera
    const rect = canvas.getBoundingClientRect(); transform = { k: Math.min(1.3, transform.k * 1.1), x: rect.width / 2, y: rect.height / 2 }
    renderInspectorPanel()
  }
  function projectedPos() { const m = new Map<string, P>(); for (const n of view.nodes) { const p = scene.pos.get(n.id); if (p) m.set(n.id, p) } return m }

  // ---------- Replay ----------
  function setCursor(c: number | null) {
    cursor = c
    view = lens === 'mission' ? projectAt(scene.g, c) : scene.g
    const next = projectedPos()
    for (const id of next.keys()) if (!shown.has(id)) from.set(id, centreOf(id, next))
    animateTo(next, reduced.matches ? 0 : 260)
    scrubText.textContent = c === null || c >= scene.g.end ? 'Live end · all records' : `${fmtOffset(c, scene.g.start)} · ${view.nodes.length - 1} records so far`
    if (selected && !view.byId.has(selected)) selected = null
    renderChannels(); renderInspectorPanel(); renderList()
  }
  scrub.addEventListener('input', () => { const v = Number(scrub.value) / 1000; setCursor(v >= 1 ? null : scene.g.start + v * (scene.g.end - scene.g.start)) })
  let playing = 0
  play.addEventListener('click', () => {
    if (playing) { cancelAnimationFrame(playing); playing = 0; play.textContent = 'Replay'; return }
    const moments = scene.g.moments; let i = 0; play.textContent = 'Stop'
    let last = 0
    const step = (t: number) => {
      if (t - last > (reduced.matches ? 900 : 420)) { last = t; const m = moments[i++]; if (m === undefined) { playing = 0; play.textContent = 'Replay'; setCursor(null); scrub.value = '1000'; return } scrub.value = String(Math.round(((m - scene.g.start) / Math.max(1, scene.g.end - scene.g.start)) * 1000)); setCursor(m) }
      playing = requestAnimationFrame(step)
    }
    playing = requestAnimationFrame(step)
  })

  // ---------- Input ----------
  function hit(x: number, y: number): string | null {
    let best: string | null = null, bd = Infinity
    for (const n of visibleNodes()) { const p = toScreen(shown.get(n.id)!); const d = Math.hypot(p.x - x, p.y - y); const r = sizeOf(n) + 8; if (d < r && d < bd) { bd = d; best = n.id } }
    return best
  }
  let drag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y, moved: false }; canvas.setPointerCapture(e.pointerId) })
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; if (drag.moved) { transform.x = drag.tx + dx; transform.y = drag.ty + dy; draw() } return }
    const h = hit(e.clientX - r.left, e.clientY - r.top)
    if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; draw() }
  })
  canvas.addEventListener('pointerup', (e) => { const r = canvas.getBoundingClientRect(); if (drag && !drag.moved) { const h = hit(e.clientX - r.left, e.clientY - r.top); select(h); if (h && e.detail === 2) toggleFocus(h) } drag = null })
  canvas.addEventListener('pointerleave', () => { hover = null; draw() })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const k = Math.max(0.25, Math.min(4, transform.k * Math.exp(-e.deltaY * 0.0015))); transform.x = mx - ((mx - transform.x) * k) / transform.k; transform.y = my - ((my - transform.y) * k) / transform.k; transform.k = k; draw() }, { passive: false })
  canvas.addEventListener('keydown', (e) => {
    const nodes = visibleNodes(); if (!nodes.length) return
    const cur = keyFocus ? toScreen(shown.get(keyFocus) ?? { x: 0, y: 0 }) : null
    const dir: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (dir[e.key]) {
      e.preventDefault()
      if (!cur) { keyFocus = nodes.find((n) => n.kind === 'stage')?.id ?? nodes[0]!.id } else {
        const [dx, dy] = dir[e.key]!; let best: string | null = null, bs = Infinity
        for (const n of nodes) { if (n.id === keyFocus || (lens === 'mission' && n.kind === 'mission')) continue; const p = toScreen(shown.get(n.id)!); const vx = p.x - cur.x, vy = p.y - cur.y; const along = vx * dx + vy * dy; if (along <= 2) continue; const across = Math.abs(vx * dy - vy * dx); const score = along + across * 2.2; if (score < bs) { bs = score; best = n.id } }
        if (best) keyFocus = best
      }
      announce(view.byId.get(keyFocus!) ?? null); draw()
    } else if (e.key === 'Enter' && keyFocus) { select(keyFocus) }
    else if ((e.key === 'f' || e.key === 'F') && (keyFocus ?? selected)) { toggleFocus((keyFocus ?? selected)!) }
    else if (e.key === 'Escape') { if (focusMode) toggleFocus(focusMode); else select(null) }
    else if (e.key === '/') { e.preventDefault(); search.focus() }
    else if (e.key === '0') { fitView(); draw() }
    else if (e.key === '+' || e.key === '=') { transform.k = Math.min(4, transform.k * 1.2); draw() }
    else if (e.key === '-') { transform.k = Math.max(0.25, transform.k / 1.2); draw() }
  })
  canvas.addEventListener('blur', () => { keyFocus = selected; draw() })
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase(); results.replaceChildren()
    if (!q) { results.hidden = true; return }
    const hits = view.nodes.filter((n) => labelOf(n).toLowerCase().includes(q) || n.detail.toLowerCase().includes(q)).slice(0, 12)
    results.hidden = !hits.length
    for (const n of hits) results.append(el('li', { role: 'option' }, el('button', { onclick: () => { select(n.id); results.hidden = true; search.value = ''; canvas.focus() } }, el('span', { class: `glyph g-${n.kind}`, 'aria-hidden': 'true' }), labelOf(n), el('span', { class: 'dim' }, ' · ' + KIND_NAME[n.kind]))))
  })
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; results.hidden = true; canvas.focus() } if (e.key === 'Enter') (results.querySelector('button') as HTMLButtonElement | null)?.click() })
  missionPicker.addEventListener('change', () => { mi = Number(missionPicker.value); rebuild(true) })
  failToggle.addEventListener('click', () => { showFailures = !showFailures; failToggle.setAttribute('aria-pressed', String(showFailures)); draw() })
  fitBtn.addEventListener('click', () => { fitView(); draw() })
  listToggle.addEventListener('click', () => { const on = listView.hidden; listView.hidden = !on; canvas.hidden = on; listToggle.setAttribute('aria-pressed', String(on)) })
  new ResizeObserver(() => { fitView(); drawTicks(); draw() }).observe(canvas)
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus() } })

  // Expose a tiny hook for automated capture and benchmarks.
  ;(window as any).hydraProto = { select, toggleFocus, setLens, setCursor: (v: number) => { scrub.value = String(Math.round(v * 1000)); scrub.dispatchEvent(new Event('input')) }, mission: (i: number) => { missionPicker.value = String(i); missionPicker.dispatchEvent(new Event('change')) }, stress: (n: number) => { stressCount = n; setLens('stress') }, draw, failures: () => failToggle.click(), nodes: () => view.nodes.map((n) => n.id) }
  // Phones: the list is the primary view; the map stays one tap away.
  if (matchMedia('(max-width: 600px)').matches) { listView.hidden = false; canvas.hidden = true; listToggle.setAttribute('aria-pressed', 'true') }
  rebuild(true)
}

const SANS = '"Archivo", "Segoe UI", system-ui, sans-serif'
const MONO = '"Azeret Mono", "Cascadia Mono", Consolas, monospace'
Promise.allSettled([document.fonts.load('500 12px "Archivo"'), document.fonts.load('500 11px "Azeret Mono"')]).then(main)
