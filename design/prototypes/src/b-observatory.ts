/**
 * Concept B — Engineering Observatory.
 * Recorded time runs left to right through four planes: You, Agents, Code, Proof. Every revision
 * is a gate cut through all planes; selecting a gate shows the cross-section of what was true at
 * that exact commit. An overview strip above is the replay scrubber and a brush for zooming.
 * "Depth" tilts the planes into a stack for orientation; flat is the reading mode.
 * SVG throughout: every mark is a focusable element with a text label.
 */
import { projectAt, STAGE_LABEL, type IntelGraph } from '../../../packages/ui/src/ops/intel/graph'
import { loadPack, el, renderInspector, fixtureBanner, neighbours, fmtOffset, fmtDuration, KIND_NAME, SCENARIO_NAME, statusWord, ROLE_NAME } from './shared'

const NS = 'http://www.w3.org/2000/svg'
const svg = (tag: string, attrs: Record<string, any> = {}, ...kids: Array<Node | string | null>) => {
  const n = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) n.setAttribute(k, String(v))
  for (const k of kids) if (k !== null) n.append(k)
  return n
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const GUTTER = 168
const OUT = 128

interface Mark { id: string; x: number; plane: number; label: string }

async function main() {
  const { pack, missions } = await loadPack()
  const root = document.getElementById('app')!
  let mi = 0
  let full: IntelGraph = missions[0]!.graph
  let g: IntelGraph = full
  let cursor: number | null = null
  let win: [number, number] = [full.start, full.end]
  let selected: string | null = null
  let depth = false
  let marks: Mark[] = []

  const missionPicker = el('select', { id: 'mission', 'aria-label': 'Mission' }, ...missions.map((m, i) => el('option', { value: String(i) }, `${SCENARIO_NAME[m.scenario] ?? m.scenario} — ${m.title}`)))
  const depthBtn = el('button', { class: 'btn', 'aria-pressed': 'false', title: 'Tilt the planes into a stack for orientation' }, 'Depth')
  const fitBtn = el('button', { class: 'btn btn-quiet' }, 'Whole mission')
  const playBtn = el('button', { class: 'btn' }, 'Replay')
  const title = el('h1', { class: 'm-title' })
  const meta = el('div', { class: 'm-meta' })
  const overview = el('div', { class: 'overview', role: 'group', 'aria-label': 'Overview and replay. Drag to zoom into a time window; click to move the replay cursor.' })
  const obs = el('div', { class: 'observatory', role: 'application', 'aria-label': 'Observatory planes. Tab moves between planes; left and right arrows move through recorded marks in time; Enter inspects.' })
  const stack = el('div', { class: 'stack' })
  const narrow = el('div', { class: 'narrow' })
  obs.append(stack)
  const section = el('aside', { class: 'xsect', 'aria-label': 'Cross-section and evidence' })
  const live = el('div', { class: 'sr-only', 'aria-live': 'polite' })

  root.append(fixtureBanner(pack),
    el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('b', {}, 'Hydra'), el('span', { class: 'mono dim' }, 'B · Engineering observatory')),
      missionPicker, el('span', { class: 'grow' }), fitBtn, depthBtn, playBtn),
    el('main', { class: 'room' },
      el('section', { class: 'deck', 'aria-label': 'Mission observatory' }, el('div', { class: 'mhead' }, title, meta), overview, obs, narrow),
      section),
    live)

  function load(i: number) { mi = i; full = missions[i]!.graph; g = full; cursor = null; win = [full.start, Math.max(full.end, full.start + 1000)]; selected = null; render() }

  // ---------- scales ----------
  function xOf(t: number, width: number) { const [a, b] = win; return GUTTER + ((t - a) / Math.max(1, b - a)) * (width - GUTTER - OUT) }
  function inWin(t: number | null) { return t !== null && t >= win[0] - 1 && t <= win[1] + 1 }

  // ---------- render ----------
  function render() {
    g = projectAt(full, cursor)
    const width = obs.clientWidth || 1000
    title.textContent = g.task.title
    const head = full.nodes.filter((n) => n.kind === 'revision')
    meta.replaceChildren(
      el('span', { class: 'pill' }, g.task.intent === 'analyze' ? 'Question' : 'Change'),
      el('span', { class: 'pill' }, full.task.status.replace('_', ' ') + (full.task.waitReason ? ' · ' + full.task.waitReason.replace('_', ' ') : '')),
      el('span', { class: 'mono dim' }, `${missions[mi]!.project.name} · ${fmtDuration(full.end - full.start)} recorded · ${head.length} revision${head.length === 1 ? '' : 's'}`))
    renderOverview()
    marks = []
    stack.replaceChildren(...planes(width))
    // Narrow screens: the planes need width to carry time, so offer the cross-sections as a list.
    narrow.replaceChildren(el('p', { class: 'plane-note' }, 'Time planes need a wider window. Revisions, in recorded order:'), ...full.nodes.filter((n) => n.kind === 'revision').map((r) => el('button', { class: 'btn', onclick: () => select(r.id) }, `${r.revision!.short} · ${r.detail}`)))
    stack.querySelectorAll<SVGElement>('[data-id]').forEach((m) => m.addEventListener('click', (e) => { e.stopPropagation(); select(m.dataset.id!) }))
    applySelection()
    renderSection()
  }

  function planeShell(i: number, name: string, sub: string, height: number, width: number) {
    const s = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': `${name} plane` })
    s.append(svg('rect', { x: 0, y: 0, width, height, class: 'plane-bg' }))
    s.append(svg('text', { x: 18, y: 22, class: 'plane-name' }, name), svg('text', { x: 18, y: 38, class: 'plane-sub' }, sub))
    s.append(svg('line', { x1: GUTTER - 10, x2: GUTTER - 10, y1: 46, y2: height - 8, class: 'gutter-rule' }))
    s.append(svg('text', { x: width - OUT + 14, y: 22, class: 'plane-sub' }, i === 2 ? 'FINAL CHANGE' : i === 3 ? 'AT HEAD' : ''))
    const wrap = el('div', { class: 'plane', style: { '--i': String(i) } as any, tabindex: '0', 'data-plane': String(i), 'aria-label': `${name}: ${sub}` }, s as unknown as Node)
    return { s, wrap }
  }

  function gates(s: SVGElement, height: number, width: number, top: boolean) {
    for (const r of g.nodes.filter((n) => n.kind === 'revision')) {
      const t = r.at ?? full.end
      if (!inWin(t)) continue
      const x = xOf(t, width)
      const gsel = svg('g', { 'data-id': r.id, class: `gate ${r.revision!.role}`, tabindex: '-1', role: 'button', 'aria-label': `Revision ${r.revision!.short}` })
      gsel.append(svg('line', { x1: x, x2: x, y1: 0, y2: height, class: 'gate-line' }))
      if (top) { gsel.append(svg('rect', { x: x - 34, y: 4, width: 68, height: 18, rx: 2, class: 'gate-tab' }), svg('text', { x, y: 17, class: 'gate-label', 'text-anchor': 'middle' }, `${r.revision!.short}${r.revision!.role === 'base' ? ' base' : r.revision!.role === 'head' || r.revision!.role === 'applied' ? ' head' : ''}`)) }
      s.append(gsel)
      if (top) marks.push({ id: r.id, x, plane: 0, label: `Revision ${r.revision!.short}` })
    }
  }

  function planes(width: number): HTMLElement[] {
    const out: HTMLElement[] = []
    const lane = (y: number, label: string, s: SVGElement) => { s.append(svg('text', { x: GUTTER - 18, y: y + 4, class: 'lane-label', 'text-anchor': 'end' }, label), svg('line', { x1: GUTTER, x2: width - OUT, y1: y, y2: y, class: 'lane-rule' })) }

    // 0 · You
    {
      const h = 84
      const { s, wrap } = planeShell(0, 'You', 'request · decision', h, width)
      gates(s, h, width, true)
      lane(54, 'decisions', s)
      const m = g.byId.get('mission')!
      if (inWin(m.at)) { const x = xOf(m.at!, width); s.append(mark('mission', x, 54, svg('circle', { cx: x, cy: 54, r: 5, class: 'm-human' }), 'Asked', 0)) }
      const d = g.byId.get('decision')
      if (d && d.at !== null && inWin(d.at)) {
        const x = xOf(d.at, width)
        const shape = svg('g', {}, svg('circle', { cx: x, cy: 54, r: 7, class: d.status === 'blocked' ? 'm-stop-ring' : 'm-human-ring' }), svg('line', { x1: x - 11, x2: x + 11, y1: 54, y2: 54, class: d.status === 'blocked' ? 'm-stop-ring' : 'm-human-ring' }), svg('line', { x1: x, x2: x, y1: 43, y2: 65, class: d.status === 'blocked' ? 'm-stop-ring' : 'm-human-ring' }))
        s.append(mark('decision', x, 54, shape, d.label + (d.status === 'blocked' ? ' · blocked' : d.status === 'waiting' ? ' · waiting' : ''), 0, true))
      }
      out.push(wrap)
    }
    // 1 · Agents
    {
      const roles: Array<'planner' | 'implementer' | 'reviewer'> = ['planner', 'implementer', 'reviewer']
      const h = 56 + roles.length * 34
      const { s, wrap } = planeShell(1, 'Agents', 'runs · tool calls', h, width)
      gates(s, h, width, false)
      const yOf = (r: string) => 62 + roles.indexOf(r as any) * 34
      roles.forEach((r) => lane(yOf(r), ROLE_NAME[r]!, s))
      const runs = g.nodes.filter((n) => n.kind === 'run').sort((a, b) => a.at! - b.at!)
      // Handoffs: recorded order between consecutive runs (agents take turns).
      runs.forEach((r, i) => {
        const next = runs[i + 1]; if (!next || r.end === null || !inWin(r.end)) return
        const x1 = xOf(r.end, width), x2 = xOf(next.at!, width), y1 = yOf(r.actor!), y2 = yOf(next.actor!)
        s.append(svg('path', { d: `M${x1},${y1} C${x1 + 18},${y1} ${x2 - 18},${y2} ${x2},${y2}`, class: 'baton' }))
      })
      for (const r of runs) {
        if (!inWin(r.at) && !inWin(r.end)) continue
        const x1 = xOf(Math.max(r.at!, win[0]), width), x2 = xOf(Math.min(r.end ?? full.end, win[1]), width)
        const y = yOf(r.actor!)
        const f = r.runFacts!
        const beam = svg('g', {})
        beam.append(svg('rect', { x: x1, y: y - 6, width: Math.max(3, x2 - x1), height: 12, rx: 2, class: `beam ${r.status}` }))
        for (const a of f.activity) { const t = Date.parse(a.at); if (!inWin(t) || (cursor !== null && t > cursor)) continue; const ax = xOf(t, width); beam.append(a.kind === 'edit' ? svg('rect', { x: ax - 1, y: y - 9, width: 2, height: 18, class: 'tick-edit' }) : a.kind === 'command' ? svg('rect', { x: ax - 2.5, y: y - 2.5, width: 5, height: 5, class: 'tick-cmd' }) : svg('circle', { cx: ax, cy: y, r: 1.8, class: 'tick-read' })) }
        s.append(mark(r.id, x1, y, beam, `${r.label} · ${statusWord(r)} · ${f.activity.length} reported calls`, 1))
        s.append(svg('text', { x: x1, y: y - 11, class: 'beam-label' }, `${STAGE_LABEL[r.stage!]}${r.attempt && r.attempt > 1 ? ' ' + r.attempt : ''}`))
      }
      out.push(wrap)
    }
    // 2 · Code
    {
      const files = g.nodes.filter((n) => n.kind === 'file').sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity))
      const h = 56 + Math.max(files.length, 1) * 26
      const { s, wrap } = planeShell(2, 'Code', 'files touched', h, width)
      gates(s, h, width, false)
      if (!files.length) s.append(svg('text', { x: GUTTER, y: 70, class: 'plane-sub' }, 'No file activity recorded at this point.'))
      files.forEach((f, i) => {
        const y = 62 + i * 26
        const ff = f.file!
        s.append(svg('text', { x: GUTTER - 18, y: y + 4, class: `file-label ${ff.diff ? 'changed' : ''} ${f.basis === 'planned' ? 'planned' : ''}`, 'text-anchor': 'end', 'data-id': f.id }, ff.path.length > 22 ? '…' + ff.path.slice(-21) : ff.path))
        s.append(svg('line', { x1: GUTTER, x2: width - OUT, y1: y, y2: y, class: `lane-rule ${f.basis === 'planned' ? 'planned' : ''}` }))
        for (const e of g.edges.filter((e) => e.to === f.id && (e.kind === 'read' || e.kind === 'edit'))) {
          if (!inWin(e.at)) continue
          const x = xOf(e.at!, width)
          s.append(e.kind === 'edit' ? svg('rect', { x: x - 1.5, y: y - 8, width: 3, height: 16, class: 'tick-edit', 'data-id': e.from }) : svg('circle', { cx: x, cy: y, r: 2.4, class: 'tick-read', 'data-id': e.from }))
        }
        for (const e of g.edges.filter((e) => e.to === f.id && e.kind === 'concerns')) {
          const fd = g.byId.get(e.from)!; if (!inWin(fd.at)) continue
          const x = xOf(fd.at!, width) + 6
          const sev = fd.finding!.severity
          s.append(mark(fd.id, x, y, svg('path', { d: `M${x},${y - 7} L${x + 6},${y + 4} L${x - 6},${y + 4} Z`, class: `finding ${sev}` }), `${sev} finding: ${fd.label}`, 2))
        }
        // Outcome column: the final diff, if this point in time has reached the head.
        if (ff.diff) { const tot = ff.diff.additions + ff.diff.deletions || 1; const w = 48; const x0 = width - OUT + 14; s.append(svg('rect', { x: x0, y: y - 4, width: (w * ff.diff.additions) / tot, height: 8, class: 'diff-add' }), svg('rect', { x: x0 + (w * ff.diff.additions) / tot, y: y - 4, width: (w * ff.diff.deletions) / tot, height: 8, class: 'diff-del' }), svg('text', { x: x0 + w + 8, y: y + 4, class: 'diff-num' }, `+${ff.diff.additions} −${ff.diff.deletions}`)) }
        marks.push({ id: f.id, x: GUTTER - 20, plane: 2, label: `File ${ff.path}` })
        const hit = svg('rect', { x: 0, y: y - 12, width: GUTTER - 8, height: 24, class: 'row-hit', 'data-id': f.id })
        s.append(hit)
      })
      out.push(wrap)
    }
    // 3 · Proof
    {
      const checks = g.nodes.filter((n) => n.kind === 'check')
      const labels = [...new Set(checks.map((c) => c.label))]
      const h = 56 + Math.max(labels.length, 1) * 30
      const { s, wrap } = planeShell(3, 'Proof', 'checks per revision', h, width)
      gates(s, h, width, false)
      if (!labels.length) s.append(svg('text', { x: GUTTER, y: 70, class: 'plane-sub' }, 'No checks have run at this point.'))
      labels.forEach((l, i) => {
        const y = 64 + i * 30
        lane(y, l, s)
        for (const c of checks.filter((c) => c.label === l)) {
          if (!inWin(c.at)) continue
          const x = xOf(c.at!, width)
          const w = Math.max(10, xOf(c.end ?? c.at!, width) - x)
          const ok = c.status === 'ok'
          // The before/after baseline runs on your original code; it is context, not a current result.
          const baseline = c.evidence!.phase === 'demo_base'
          const hex = svg('g', {}, svg('rect', { x, y: y - 7, width: w, height: 14, rx: 7, class: `proof ${c.status} ${baseline ? 'baseline' : ''}` }), ok || baseline ? null : svg('text', { x: x + w / 2, y: y + 4, class: 'proof-x', 'text-anchor': 'middle' }, c.status === 'running' ? '…' : '✕'))
          if (baseline) hex.append(svg('text', { x: x + w / 2, y: y - 10, class: 'baseline-label', 'text-anchor': 'middle' }, ok ? 'original ✓' : 'original ✕'))
          s.append(mark(c.id, x, y, hex, `${l} ${statusWord(c)} at ${c.evidence!.commitSha.slice(0, 7)}${baseline ? ' (your original code, for before/after)' : ''}`, 3))
        }
        // At head: the latest verify result at the head revision, which is what acceptance uses.
        const headRev = full.nodes.find((n) => n.kind === 'revision' && (n.revision!.role === 'head' || n.revision!.role === 'applied'))
        const atHead = checks.filter((c) => c.label === l && headRev && c.evidence!.commitSha.startsWith(headRev.revision!.short) && c.evidence!.phase === 'verify').at(-1)
        s.append(svg('text', { x: width - OUT + 12, y: y + 4, class: `athead ${atHead ? atHead.status : 'none'}` }, atHead ? (atHead.status === 'ok' ? '✓ passed' : '✕ failed') : '— none'))
      })
      out.push(wrap)
    }
    // Replay cursor across every plane
    if (cursor !== null && inWin(cursor)) for (const w of out) { const s = w.querySelector('svg')!; const x = xOf(cursor, width); s.append(svg('line', { x1: x, x2: x, y1: 0, y2: Number(s.getAttribute('height')), class: 'cursor' })) }
    return out
  }

  function mark(id: string, x: number, y: number, shape: SVGElement, label: string, plane: number, wide = false) {
    const gEl = svg('g', { 'data-id': id, class: 'mk', role: 'button', 'aria-label': label })
    gEl.append(shape)
    if (wide) { const nearEnd = x > (obs.clientWidth || 1000) - OUT - 200; gEl.append(svg('text', { x: nearEnd ? x - 14 : x + 14, y: y + 4, class: 'mk-label', 'text-anchor': nearEnd ? 'end' : 'start' }, label)) }
    marks.push({ id, x, plane, label })
    return gEl
  }

  function renderOverview() {
    const width = overview.clientWidth || 1000
    const h = 64
    const s = svg('svg', { width, height: h, viewBox: `0 0 ${width} ${h}` })
    const X = (t: number) => 10 + ((t - full.start) / Math.max(1, full.end - full.start)) * (width - 20)
    s.append(svg('rect', { x: 0, y: 0, width, height: h, class: 'ov-bg' }))
    // Stage bands, one row per actor family, like a trace summary.
    for (const st of full.nodes.filter((n) => n.kind === 'stage')) {
      const row = st.actor === 'planner' ? 0 : st.actor === 'implementer' ? 1 : st.actor === 'reviewer' ? 2 : 3
      const x1 = X(st.at!), x2 = X(st.end ?? full.end)
      s.append(svg('rect', { x: x1, y: 10 + row * 11, width: Math.max(2, x2 - x1), height: 8, rx: 2, class: `ov-stage ${st.status} r-${st.actor}` }))
    }
    for (const c of full.nodes.filter((n) => n.kind === 'check' && n.status === 'failed' && n.evidence!.phase !== 'demo_base')) s.append(svg('rect', { x: X(c.at!) - 1, y: 6, width: 2, height: 50, class: 'ov-fail' }))
    // Zoom window
    s.append(svg('rect', { x: X(win[0]), y: 2, width: Math.max(2, X(win[1]) - X(win[0])), height: h - 4, class: 'ov-win' }))
    if (cursor !== null) s.append(svg('line', { x1: X(cursor), x2: X(cursor), y1: 0, y2: h, class: 'cursor' }))
    s.append(svg('text', { x: width - 12, y: h - 8, class: 'ov-label', 'text-anchor': 'end' }, cursor === null ? 'all records · drag to zoom · click to replay to a moment' : `replay ${fmtOffset(cursor, full.start)}`))
    overview.replaceChildren(s as unknown as Node)
    let dragX: number | null = null
    const T = (x: number) => full.start + ((x - 10) / (width - 20)) * (full.end - full.start)
    s.addEventListener('pointerdown', (e: any) => { dragX = e.offsetX; (s as any).setPointerCapture(e.pointerId) })
    s.addEventListener('pointerup', (e: any) => {
      if (dragX === null) return
      const a = Math.min(dragX, e.offsetX), b = Math.max(dragX, e.offsetX); dragX = null
      if (b - a < 6) { const t = T(e.offsetX); cursor = t >= full.end - 50 ? null : Math.max(full.start, t) } else { win = [Math.max(full.start, T(a)), Math.min(full.end, T(b))] }
      render()
    })
  }

  // ---------- selection ----------
  function related(id: string) { const r = new Set([id]); for (const e of g.edges) { if (e.from === id) r.add(e.to); if (e.to === id) r.add(e.from) } return r }
  function applySelection() {
    const rel = selected ? related(selected) : null
    stack.classList.toggle('has-sel', !!rel)
    stack.querySelectorAll<SVGElement>('[data-id]').forEach((m) => m.classList.toggle('rel', !!rel && rel.has(m.dataset.id!)))
    stack.querySelectorAll<SVGElement>('[data-id]').forEach((m) => m.classList.toggle('sel', m.dataset.id === selected))
  }
  function select(id: string | null) {
    selected = id; applySelection(); renderSection()
    const n = id ? g.byId.get(id) : null
    if (n) live.textContent = `${KIND_NAME[n.kind]} ${n.kind === 'file' ? n.file!.path : n.label}. ${statusWord(n) ?? ''}.`
  }

  /** Cross-section: what was true at one revision, then the regular evidence inspector. */
  function renderSection() {
    const n = selected ? g.byId.get(selected) ?? null : null
    const parts: Node[] = []
    if (n?.kind === 'revision') {
      const sha = n.revision!.short
      const checks = g.nodes.filter((c) => c.kind === 'check' && c.evidence!.commitSha.startsWith(sha))
      const produced = g.edges.filter((e) => e.kind === 'produced' && e.to === n.id).map((e) => g.byId.get(e.from)!)
      const reviewed = g.edges.filter((e) => e.kind === 'reviewed' && e.to === n.id).map((e) => g.byId.get(e.from)!)
      const findings = g.nodes.filter((f) => f.kind === 'finding' && f.finding!.reviewedSha?.startsWith(sha))
      const decided = g.edges.some((e) => e.kind === 'decides' && e.to === n.id)
      parts.push(el('div', { class: 'xs' },
        el('p', { class: 'insp-eyebrow' }, 'Cross-section'),
        el('h2', { class: 'insp-title mono' }, sha),
        el('p', { class: 'insp-hint' }, n.detail),
        el('ol', { class: 'xs-rows' },
          el('li', {}, el('span', { class: 'xs-k' }, 'Made by'), el('span', {}, produced.length ? produced.map((p) => p.label).join(', ') : n.revision!.role === 'base' ? 'Your branch' : 'Not named in records')),
          el('li', {}, el('span', { class: 'xs-k' }, 'Proof'), el('span', {}, checks.length ? `${checks.filter((c) => c.status === 'ok').length} passed · ${checks.filter((c) => c.status === 'failed').length} failed` : 'No checks ran here')),
          el('li', {}, el('span', { class: 'xs-k' }, 'Review'), el('span', {}, reviewed.length ? `${reviewed.map((r) => r.label).join(', ')} · ${findings.length} finding${findings.length === 1 ? '' : 's'}` : 'Not reviewed at this revision')),
          el('li', {}, el('span', { class: 'xs-k' }, 'Decision'), el('span', {}, decided ? 'Your decision applies to this revision' : '—')))))
    }
    parts.push(renderInspector(g, n, { onSelect: (id) => select(id) }))
    section.replaceChildren(...parts)
    if (!reduced.matches) { section.classList.remove('reveal'); void section.offsetWidth; section.classList.add('reveal') }
  }

  // ---------- keyboard: planes are tab stops, arrows move through time ----------
  let kIndex = -1
  obs.addEventListener('keydown', (e) => {
    const plane = Number((document.activeElement as HTMLElement)?.dataset?.plane ?? -1)
    if (plane < 0) return
    const list = marks.filter((m) => m.plane === plane).sort((a, b) => a.x - b.x)
    if (!list.length) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault(); kIndex = Math.max(0, Math.min(list.length - 1, kIndex + (e.key === 'ArrowRight' ? 1 : -1)))
      const m = list[kIndex]!; selected = m.id; applySelection(); live.textContent = m.label
    } else if (e.key === 'Enter' && selected) { renderSection() }
    else if (e.key === 'Escape') { select(null) }
  })
  obs.addEventListener('focusin', () => { kIndex = -1 })

  // ---------- controls ----------
  missionPicker.addEventListener('change', () => load(Number(missionPicker.value)))
  depthBtn.addEventListener('click', () => { depth = !depth; depthBtn.setAttribute('aria-pressed', String(depth)); obs.classList.toggle('depth', depth) })
  fitBtn.addEventListener('click', () => { win = [full.start, full.end]; render() })
  let timer = 0
  playBtn.addEventListener('click', () => {
    if (timer) { clearInterval(timer); timer = 0; playBtn.textContent = 'Replay'; cursor = null; render(); return }
    const moments = full.moments; let i = 0; playBtn.textContent = 'Stop'
    timer = window.setInterval(() => { const m = moments[i++]; if (m === undefined || m >= full.end) { clearInterval(timer); timer = 0; playBtn.textContent = 'Replay'; cursor = null } else cursor = m; render() }, reduced.matches ? 900 : 380)
  })
  new ResizeObserver(() => render()).observe(obs)
  ;(window as any).hydraProto = { select, mission: (i: number) => { missionPicker.value = String(i); load(i) }, depth: () => depthBtn.click(), cursor: (f: number) => { cursor = f >= 1 ? null : full.start + f * (full.end - full.start); render() }, rev: (k: number) => select(full.nodes.filter((n) => n.kind === 'revision')[k]?.id ?? null) }
  load(0)
}
Promise.allSettled([document.fonts.load('500 13px "Atkinson Hyperlegible Next"'), document.fonts.load('500 12px "Atkinson Hyperlegible Mono"')]).then(main)
void neighbours
