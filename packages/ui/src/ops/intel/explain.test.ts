import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { explainNode, type Explanation } from './explain'
import { buildIntel, emptyCounts, projectAt, type IntelGraph, type IntelNode } from './graph'
import { layoutProject } from './layout'

// Recorded with tools/record-ux-fixtures.ts: real engine, Git and checks; scripted agents.
const pack = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../design/prototypes/data/missions.json', import.meta.url)), 'utf8'))
const scenarios: string[] = pack.missions.map((m: { scenario: string }) => m.scenario)
const graphOf = (scenario: string): IntelGraph => {
  const m = pack.missions.find((x: { scenario: string }) => x.scenario === scenario)
  return buildIntel({ task: m.detail.task, runs: m.detail.runs, evidence: m.detail.evidence, diff: m.diff, reviews: m.reviews.map((r: { at: string }) => ({ ...r, at: Date.parse(r.at) })), now: Date.parse(pack.recordedAt) })
}
const all = (x: Explanation) => [x.what, ...x.here, x.next ?? ''].join(' ')
const clean = (x: Explanation) => {
  expect(x.what.length).toBeGreaterThan(20)
  expect(x.here.length).toBeGreaterThan(0)
  for (const s of x.here) expect(s.trim().length).toBeGreaterThan(5)
  expect(all(x)).not.toMatch(/undefined|NaN|\bnull\b|\[object|Infinity/)
}

describe('plain-English explanations', () => {
  it('explain every selectable record in every recorded mission, without gaps or placeholders', () => {
    const kinds = new Set<string>()
    for (const s of scenarios) {
      const g = graphOf(s)
      for (const n of g.nodes) { clean(explainNode(n, g)); kinds.add(n.kind) }
    }
    expect([...kinds].sort()).toEqual(['agent', 'check', 'decision', 'file', 'finding', 'mission', 'revision', 'run', 'stage'])
  })

  it('stay correct at every replay moment (only what was recorded so far)', () => {
    const g = graphOf('repair')
    for (const m of g.moments.filter((_, i) => i % 3 === 0)) { const p = projectAt(g, m); for (const n of p.nodes) clean(explainNode(n, p)) }
  })

  it('say what actually happened, from the record', () => {
    const fail = graphOf('verify-fail')
    const failed = fail.nodes.find((n) => n.kind === 'check' && n.status === 'failed')!
    const c = all(explainNode(failed, fail))
    expect(c).toContain(`exit code ${failed.evidence!.exitCode}`)
    expect(c).toContain(failed.evidence!.commitSha.slice(0, 7))
    expect(all(explainNode(fail.byId.get('decision')!, fail))).toMatch(/will not let you accept yet/)

    const repair = graphOf('repair')
    const base = repair.nodes.find((n) => n.kind === 'revision' && n.revision!.role === 'base')!
    expect(all(explainNode(base, repair))).toMatch(/starting point/)
    const finding = repair.nodes.find((n) => n.kind === 'finding')!
    expect(all(explainNode(finding, repair))).toContain(finding.finding!.severity === 'nit' ? 'nit' : finding.finding!.severity)
    const agent = repair.nodes.find((n) => n.kind === 'agent')!
    expect(all(explainNode(agent, repair))).toContain(`${agent.agent!.runs.length} time`)
    const handed = repair.nodes.find((n) => n.kind === 'run' && repair.edges.some((e) => e.kind === 'handoff' && e.to === n.id))!
    const h = repair.edges.find((e) => e.kind === 'handoff' && e.to === handed.id)!
    expect(all(explainNode(handed, repair))).toContain(h.label!)

    const gate = graphOf('plan-gate')
    expect(all(explainNode(gate.byId.get('decision')!, gate))).toMatch(/plan is ready/)
  })

  it('explain missions and files on the project map', () => {
    const mk = (id: string, status: IntelNode['status']): IntelNode => ({ id, kind: 'mission', label: `Mission ${id}`, detail: 'Add rate limiting to the login route', basis: 'observed', status, actor: 'human', at: 0, end: 1, weight: 1 })
    const { nodes, edges } = layoutProject([
      { id: 'task:a', label: 'A', node: mk('task:a', 'ok'), files: [{ path: 'src/login.ts', kind: 'edit' }, { path: 'README.md', kind: 'read' }] },
      { id: 'task:b', label: 'B', node: mk('task:b', 'waiting'), files: [{ path: 'src/login.ts', kind: 'read' }, { path: 'docs/plan.md', kind: 'planned' }] }
    ])
    const g = { task: undefined, nodes, edges, byId: new Map(nodes.map((n) => [n.id, n])), start: 0, end: 1, moments: [], live: false, counts: emptyCounts(), gaps: [] } as unknown as IntelGraph
    for (const n of nodes) clean(explainNode(n, g, 'project'))
    expect(all(explainNode(g.byId.get('task:a')!, g, 'project'))).toMatch(/edited 1 file, read 1 file/)
    expect(all(explainNode(g.byId.get('task:b')!, g, 'project'))).toMatch(/waiting for your decision/)
    expect(all(explainNode(g.byId.get('file:src/login.ts')!, g, 'project'))).toMatch(/1 mission that edited it and 1 mission that only read it/)
    expect(all(explainNode(g.byId.get('file:docs/plan.md')!, g, 'project'))).toMatch(/only appears in a plan/)
  })
})

describe('agent-written explanations', () => {
  it('lead with their first sentence, without splitting file names or versions', async () => {
    const { leadSentence } = await import('./explain')
    const [a, b] = leadSentence('manipulation.py is the interaction core of telekinisis. It holds objects cut out of real camera frames as `Sprite`s.')
    expect(a).toBe('manipulation.py is the interaction core of telekinisis.')
    expect(b).toMatch(/^It holds/)
    const [c, d] = leadSentence('pytest runs the whole Vector test suite, and this run failed on a single test out of about 170. The failing test is `test_move_only_keeps_size`.')
    expect(c).toMatch(/about 170\.$/)
    expect(d).toMatch(/^The failing test/)
    expect(leadSentence('Short.')).toEqual(['Short.', ''])
    expect(leadSentence('No full stop at all')).toEqual(['No full stop at all', ''])
  })
})
