import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildIntel, fileTarget, projectAt, type IntelGraph } from './graph'
import { layoutMission } from './layout'

// Recorded with tools/record-ux-fixtures.ts: real engine, Git and checks; scripted agents.
const pack = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../design/prototypes/data/missions.json', import.meta.url)), 'utf8'))
const graphOf = (scenario: string): IntelGraph => {
  const m = pack.missions.find((x: { scenario: string }) => x.scenario === scenario)
  return buildIntel({ task: m.detail.task, runs: m.detail.runs, evidence: m.detail.evidence, diff: m.diff, reviews: m.reviews.map((r: { at: string }) => ({ ...r, at: Date.parse(r.at) })), now: Date.parse(pack.recordedAt) })
}

describe('agents', () => {
  it('names one agent per role and provider in the run records, linked to exactly its runs', () => {
    const g = graphOf('repair')
    const agents = g.nodes.filter((n) => n.kind === 'agent')
    expect(agents.map((a) => a.id).sort()).toEqual(['agent:implementer:scripted', 'agent:planner:scripted', 'agent:reviewer:scripted'])
    for (const a of agents) {
      const runs = g.edges.filter((e) => e.kind === 'acts' && e.from === a.id).map((e) => g.byId.get(e.to)!)
      expect(runs.length).toBe(a.agent!.runs.length)
      for (const r of runs) expect(r.runFacts!.run.role).toBe(a.agent!.role)
    }
    expect(g.byId.get('agent:implementer:scripted')!.agent!.runs.length).toBe(2)
  })

  it('draws a handoff only where a recorded artifact links two consecutive runs', () => {
    const g = graphOf('repair')
    const h = g.edges.filter((e) => e.kind === 'handoff').sort((a, b) => a.at! - b.at!)
    expect(h.map((e) => e.label)).toEqual(['the plan', 'revision dd0d9cb', '3 findings', 'revision b35d463'])
    for (const e of h) {
      expect(e.basis).toBe('derived')
      for (const v of e.via ?? []) expect(g.byId.has(v)).toBe(true)
      // The receiving run is recorded as reviewing the revision it was handed.
      if (e.label!.startsWith('revision')) expect(g.edges.some((x) => x.kind === 'reviewed' && x.from === e.to && x.to === e.via![0])).toBe(true)
    }
    // A failed run that nothing followed hands nothing off.
    const failure = graphOf('failure')
    expect(failure.edges.filter((e) => e.kind === 'handoff').map((e) => e.label)).toEqual(['the plan'])
  })

  it('replay shows agents and tool calls only as recorded up to the cursor', () => {
    const g = graphOf('repair')
    const reviewStart = g.nodes.filter((n) => n.kind === 'run' && n.runFacts!.run.role === 'reviewer').map((n) => n.at!).sort((a, b) => a - b)[0]!
    const early = projectAt(g, reviewStart - 1)
    expect(early.byId.has('agent:reviewer:scripted')).toBe(false)
    expect(early.edges.some((e) => e.kind === 'handoff' && e.label!.startsWith('revision'))).toBe(false)
    const impl = early.byId.get('agent:implementer:scripted')!
    expect(impl.agent!.runs.length).toBe(1)
    for (const r of early.nodes.filter((n) => n.kind === 'run')) for (const a of r.runFacts!.activity) expect(Date.parse(a.at)).toBeLessThanOrEqual(reviewStart - 1)
  })

  it('places agents outside the clock', () => {
    const g = graphOf('repair')
    const pos = layoutMission(g)
    for (const a of g.nodes.filter((n) => n.kind === 'agent')) { const p = pos.get(a.id)!; expect(Math.hypot(p.x / 640, p.y / 400)).toBeGreaterThan(1.2) }
  })
})

describe('file targets from real provider CLIs', () => {
  const act = (target: string, kind: 'read' | 'edit' = 'read') => ({ kind, tool: 'Read', target, at: '2026-10-23T00:00:00Z' }) as Parameters<typeof fileTarget>[0]
  it('shows absolute worktree paths under their repository-relative name', () => {
    const root = 'C:\\Users\\moall\\AppData\\Local\\HydraPreviews\\HydraPreview\\worktrees\\01m5k141vhwqnqx5vdfcwvjfyx'
    expect(fileTarget(act('C:/Users/moall/AppData/Local/HydraPreviews/HydraPreview/worktrees/01m5k141vhwqnqx5vdfcwvjfyx/test_pipeline.py'), root)).toBe('test_pipeline.py')
    expect(fileTarget(act('c:\\users\\moall\\appdata\\local\\hydrapreviews\\hydrapreview\\worktrees\\01m5k141vhwqnqx5vdfcwvjfyx\\src\\a.py'), root)).toBe('src/a.py')
    expect(fileTarget(act('/home/u/.hydra/worktrees/abc/README.md'), null)).toBe('README.md')
    expect(fileTarget(act('./src/b.ts'), root)).toBe('src/b.ts')
    expect(fileTarget(act('src/**/*.ts'), root)).toBeNull()
  })
})
