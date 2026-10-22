import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildIntel, projectAt, type IntelGraph } from './graph'
import { egoLayout, layoutMission, layoutProject, RX, RY } from './layout'
import { labelOf } from './renderer'
import { neighbours, statusWord } from './text'

// Recorded with tools/record-ux-fixtures.ts: real engine, Git and checks; scripted agents.
const pack = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../design/prototypes/data/missions.json', import.meta.url)), 'utf8'))
const graphOf = (scenario: string): IntelGraph => {
  const m = pack.missions.find((x: { scenario: string }) => x.scenario === scenario)
  return buildIntel({ task: m.detail.task, runs: m.detail.runs, evidence: m.detail.evidence, diff: m.diff, reviews: m.reviews.map((r: { at: string }) => ({ ...r, at: Date.parse(r.at) })), now: Date.parse(pack.recordedAt) })
}
const SCENARIOS = ['repair', 'verify-fail', 'plan-gate', 'clean', 'failure', 'question']

describe('mission layout', () => {
  it('places every recorded node, deterministically', () => {
    for (const s of SCENARIOS) {
      const g = graphOf(s)
      const a = layoutMission(g), b = layoutMission(g)
      for (const n of g.nodes) {
        expect(a.has(n.id), `${s}: ${n.id}`).toBe(true)
        expect(Number.isFinite(a.get(n.id)!.x) && Number.isFinite(a.get(n.id)!.y)).toBe(true)
      }
      expect([...a]).toEqual([...b])
    }
  })

  it('puts stages on the clock in recorded order, clockwise from twelve', () => {
    const g = graphOf('repair')
    const pos = layoutMission(g)
    const stages = g.nodes.filter((n) => n.kind === 'stage')
    const angles = stages.map((n) => { const p = pos.get(n.id)!; return (Math.atan2(p.y / RY, p.x / RX) + Math.PI * 2.5) % (Math.PI * 2) })
    expect(angles[0]).toBeLessThan(0.01)
    for (let i = 1; i < angles.length; i++) expect(angles[i]!).toBeGreaterThan(angles[i - 1]!)
    for (const n of stages) { const p = pos.get(n.id)!; expect(Math.hypot(p.x / RX, p.y / RY)).toBeCloseTo(1, 5) }
  })

  it('keeps files inside the inner field and revisions on the spine in order', () => {
    const g = graphOf('repair')
    const pos = layoutMission(g)
    for (const n of g.nodes.filter((x) => x.kind === 'file')) { const p = pos.get(n.id)!; expect(Math.hypot(p.x / RX, p.y / RY)).toBeLessThan(0.8) }
    const revs = g.nodes.filter((n) => n.kind === 'revision').sort((a, b) => a.revision!.index - b.revision!.index)
    const xs = revs.map((r) => pos.get(r.id)!.x)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })

  it('replay keeps positions: a node never moves because the cursor moved', () => {
    const g = graphOf('repair')
    const pos = layoutMission(g)
    const early = projectAt(g, g.start + (g.end - g.start) / 3)
    expect(early.nodes.length).toBeLessThan(g.nodes.length)
    for (const n of early.nodes) expect(pos.has(n.id)).toBe(true)
  })

  it('ego focus puts inputs left and outputs right of the focused node', () => {
    const g = graphOf('repair')
    const base = layoutMission(g)
    const head = g.nodes.filter((n) => n.kind === 'revision').at(-1)!
    const ego = egoLayout(g, base, head.id)
    const { ins, outs } = neighbours(g, head.id)
    expect(ego.get(head.id)).toEqual({ x: 0, y: 0 })
    for (const { node } of ins) expect(ego.get(node.id)!.x).toBeLessThan(0)
    for (const { node } of outs) if (!ins.some((i) => i.node.id === node.id)) expect(ego.get(node.id)!.x).toBeGreaterThan(0)
  })
})

describe('project layout', () => {
  it('links missions only through shared files and counts reads and edits', () => {
    const node = (id: string) => ({ id, kind: 'mission' as const, label: id, detail: '', basis: 'observed' as const, status: 'ok' as const, actor: 'human' as const, at: 0, end: 0, weight: 1 })
    const { nodes, edges, pos } = layoutProject([
      { id: 'a', label: 'a', node: node('a'), files: [{ path: 'src/x.ts', kind: 'edit' }, { path: 'src/y.ts', kind: 'planned' }] },
      { id: 'b', label: 'b', node: node('b'), files: [{ path: 'src/x.ts', kind: 'read' }] }
    ])
    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'file:src/x.ts', 'file:src/y.ts'])
    expect(edges.every((e) => e.from === 'a' || e.from === 'b')).toBe(true)
    const x = nodes.find((n) => n.id === 'file:src/x.ts')!
    expect(x.file).toMatchObject({ edits: 1, reads: 1 })
    expect(nodes.find((n) => n.id === 'file:src/y.ts')!.basis).toBe('planned')
    expect(pos.size).toBe(4)
  })
})

describe('labels', () => {
  it('names every node in words, with a status word where one applies', () => {
    for (const s of SCENARIOS) {
      const g = graphOf(s)
      for (const n of g.nodes) {
        expect(labelOf(n).length).toBeGreaterThan(0)
        if (n.kind === 'check' || n.kind === 'finding' || n.kind === 'decision') expect(statusWord(n).length).toBeGreaterThan(0)
        expect(labelOf(n)).not.toMatch(/thinking/i)
      }
    }
  })
})
