/**
 * Rendering benchmark for the evidence network. Same synthetic graph, three renderers:
 *  - Canvas 2D (immediate mode, the approach used by Concept A)
 *  - SVG DOM (retained mode, the approach used by Concepts B and C)
 *  - WebGL via Sigma.js 3 + Graphology (MIT)
 * Two interactions per size: ISOLATE (selection changes every frame, every element restyles)
 * and PAN (the view moves every frame). Script time is measured around the work; frame interval
 * is measured between animation frames. SIMULATED data — this is a rendering test only.
 */
import Graph from 'graphology'
import Sigma from 'sigma'

interface Row { renderer: string; nodes: number; edges: number; test: string; scriptMean: number; scriptP95: number; frameMean: number; frameP95: number; setupMs: number; heapMB: number | null }
const sizes = (new URLSearchParams(location.search).get('sizes') ?? '300,2000,10000').split(',').map(Number)
const FRAMES = 60
const out: Row[] = []
const box = document.getElementById('stage')!
const log = document.getElementById('log')!

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
function makeGraph(n: number) {
  const r = rng(n)
  const nodes = Array.from({ length: n }, (_, i) => ({ id: i, x: r() * 1000, y: r() * 700, size: 3 + r() * 6, label: `src/module-${i}.ts` }))
  const edges: Array<[number, number]> = []
  for (let i = 0; i < n * 2; i++) { const a = Math.floor(r() * n); const b = Math.min(n - 1, Math.max(0, a + Math.floor((r() - 0.5) * 40))); if (a !== b) edges.push([a, b]) }
  const adj = Array.from({ length: n }, () => [] as number[])
  for (const [a, b] of edges) { adj[a]!.push(b); adj[b]!.push(a) }
  return { nodes, edges, adj }
}
const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { mean: s.reduce((a, b) => a + b, 0) / s.length, p95: s[Math.floor(s.length * 0.95)]! } }
const frame = () => new Promise<number>((r) => requestAnimationFrame(r))
const heap = () => ((performance as any).memory ? (performance as any).memory.usedJSHeapSize / 1048576 : null)

async function runFrames(step: (i: number) => void) {
  const script: number[] = []; const intervals: number[] = []
  let last = await frame()
  for (let i = 0; i < FRAMES; i++) {
    const t0 = performance.now(); step(i); script.push(performance.now() - t0)
    const now = await frame(); intervals.push(now - last); last = now
  }
  return { s: stats(script), f: stats(intervals) }
}

async function canvasBench(G: ReturnType<typeof makeGraph>) {
  box.replaceChildren(); const t0 = performance.now(); const h0 = heap()
  const c = document.createElement('canvas'); c.width = 1000 * devicePixelRatio; c.height = 700 * devicePixelRatio; c.style.width = '1000px'; c.style.height = '700px'; box.append(c)
  const ctx = c.getContext('2d')!
  let lit: Set<number> | null = null; let ox = 0, oy = 0
  const draw = () => {
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.fillStyle = '#07090c'; ctx.fillRect(0, 0, 1000, 700)
    ctx.lineWidth = 1
    for (const [a, b] of G.edges) { const on = !lit || (lit.has(a) && lit.has(b)); ctx.globalAlpha = on ? 0.35 : 0.04; ctx.strokeStyle = '#74b9ff'; ctx.beginPath(); ctx.moveTo(G.nodes[a]!.x + ox, G.nodes[a]!.y + oy); ctx.lineTo(G.nodes[b]!.x + ox, G.nodes[b]!.y + oy); ctx.stroke() }
    for (const n of G.nodes) { ctx.globalAlpha = !lit || lit.has(n.id) ? 1 : 0.12; ctx.fillStyle = '#ffb24a'; ctx.beginPath(); ctx.arc(n.x + ox, n.y + oy, n.size, 0, Math.PI * 2); ctx.fill() }
    ctx.globalAlpha = 1; ctx.fillStyle = '#e8ecf1'; ctx.font = '11px sans-serif'
    let labels = 0; for (const n of G.nodes) { if (labels++ > 150) break; ctx.fillText(n.label, n.x + ox + 8, n.y + oy + 4) }
  }
  draw(); await frame(); const setup = performance.now() - t0; const h1 = heap()
  const iso = await runFrames((i) => { const id = (i * 7919) % G.nodes.length; lit = new Set([id, ...G.adj[id]!]); draw() })
  lit = null
  const pan = await runFrames((i) => { ox = Math.sin(i / 10) * 60; oy = Math.cos(i / 10) * 40; draw() })
  return { setup, heapMB: h0 !== null && h1 !== null ? h1 - h0 : null, iso, pan }
}

async function svgBench(G: ReturnType<typeof makeGraph>) {
  box.replaceChildren(); const t0 = performance.now(); const h0 = heap()
  const NS = 'http://www.w3.org/2000/svg'
  const s = document.createElementNS(NS, 'svg'); s.setAttribute('width', '1000'); s.setAttribute('height', '700'); s.style.background = '#07090c'
  const root = document.createElementNS(NS, 'g'); s.append(root)
  const edgeEls = G.edges.map(([a, b]) => { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', String(G.nodes[a]!.x)); l.setAttribute('y1', String(G.nodes[a]!.y)); l.setAttribute('x2', String(G.nodes[b]!.x)); l.setAttribute('y2', String(G.nodes[b]!.y)); l.setAttribute('stroke', '#74b9ff'); l.setAttribute('stroke-opacity', '.35'); root.append(l); return l })
  const nodeEls = G.nodes.map((n) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', String(n.x)); c.setAttribute('cy', String(n.y)); c.setAttribute('r', String(n.size)); c.setAttribute('fill', '#ffb24a'); root.append(c); return c })
  G.nodes.slice(0, 150).forEach((n) => { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', String(n.x + 8)); t.setAttribute('y', String(n.y + 4)); t.setAttribute('fill', '#e8ecf1'); t.setAttribute('font-size', '11'); t.textContent = n.label; root.append(t) })
  box.append(s); await frame(); const setup = performance.now() - t0; const h1 = heap()
  const iso = await runFrames((i) => { const id = (i * 7919) % G.nodes.length; const lit = new Set([id, ...G.adj[id]!]); nodeEls.forEach((el, k) => el.setAttribute('opacity', lit.has(k) ? '1' : '.12')); edgeEls.forEach((el, k) => { const [a, b] = G.edges[k]!; el.setAttribute('stroke-opacity', lit.has(a) && lit.has(b) ? '.35' : '.04') }) })
  const pan = await runFrames((i) => { root.setAttribute('transform', `translate(${Math.sin(i / 10) * 60},${Math.cos(i / 10) * 40})`) })
  return { setup, heapMB: h0 !== null && h1 !== null ? h1 - h0 : null, iso, pan }
}

async function sigmaBench(G: ReturnType<typeof makeGraph>) {
  box.replaceChildren(); const t0 = performance.now(); const h0 = heap()
  const div = document.createElement('div'); div.style.width = '1000px'; div.style.height = '700px'; div.style.background = '#07090c'; box.append(div)
  const graph = new Graph()
  for (const n of G.nodes) graph.addNode(String(n.id), { x: n.x, y: -n.y, size: n.size, label: n.label, color: '#ffb24a' })
  G.edges.forEach(([a, b], k) => graph.addEdgeWithKey(String(k), String(a), String(b), { color: '#2a4a6a', size: 1 }))
  let lit: Set<string> | null = null
  const renderer = new Sigma(graph, div, { labelRenderedSizeThreshold: 8, labelColor: { color: '#e8ecf1' }, nodeReducer: (n, d) => (lit && !lit.has(n) ? { ...d, color: '#2a2a2a', label: '' } : d), edgeReducer: (e, d) => (lit && !(lit.has(graph.source(e)) && lit.has(graph.target(e))) ? { ...d, color: '#111' } : d) })
  await frame(); await frame(); const setup = performance.now() - t0; const h1 = heap()
  const iso = await runFrames((i) => { const id = (i * 7919) % G.nodes.length; lit = new Set([String(id), ...G.adj[id]!.map(String)]); renderer.refresh() })
  lit = null; renderer.refresh()
  const cam = renderer.getCamera()
  const pan = await runFrames((i) => { cam.setState({ x: 0.5 + Math.sin(i / 10) * 0.05, y: 0.5 + Math.cos(i / 10) * 0.04 }); renderer.refresh() })
  renderer.kill()
  return { setup, heapMB: h0 !== null && h1 !== null ? h1 - h0 : null, iso, pan }
}

async function main() {
  const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null
  const dbg = gl?.getExtension('WEBGL_debug_renderer_info')
  const gpu = gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  for (const n of sizes) {
    const G = makeGraph(n)
    for (const [name, fn] of [['Canvas 2D', canvasBench], ['SVG DOM', svgBench], ['WebGL · Sigma.js', sigmaBench]] as const) {
      log.textContent = `Running ${name} at ${n} nodes…`
      try {
        const r = await fn(G)
        for (const [test, m] of [['isolate', r.iso], ['pan', r.pan]] as const) out.push({ renderer: name, nodes: n, edges: G.edges.length, test, scriptMean: +m.s.mean.toFixed(2), scriptP95: +m.s.p95.toFixed(2), frameMean: +m.f.mean.toFixed(2), frameP95: +m.f.p95.toFixed(2), setupMs: +r.setup.toFixed(1), heapMB: r.heapMB === null ? null : +r.heapMB.toFixed(1) })
      } catch (e) { out.push({ renderer: name, nodes: n, edges: G.edges.length, test: 'error: ' + String(e), scriptMean: NaN, scriptP95: NaN, frameMean: NaN, frameP95: NaN, setupMs: NaN, heapMB: null }) }
    }
  }
  box.replaceChildren()
  const result = { userAgent: navigator.userAgent, gpu, dpr: devicePixelRatio, frames: FRAMES, at: new Date().toISOString(), rows: out }
  ;(window as any).benchResults = result
  log.textContent = JSON.stringify(result, null, 1)
  document.title = 'BENCH DONE'
}
main()
