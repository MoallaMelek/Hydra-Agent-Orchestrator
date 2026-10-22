import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildIntel, fileTarget, projectAt, reviewsFromSnapshots, type IntelGraph } from './graph'

// Recorded with tools/record-ux-fixtures.ts: real engine, Git and checks; scripted agents.
const pack = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../design/prototypes/data/missions.json', import.meta.url)), 'utf8'))
const graphOf = (scenario: string, withReviews = true): IntelGraph => {
  const m = pack.missions.find((x: { scenario: string }) => x.scenario === scenario)
  return buildIntel({ task: m.detail.task, runs: m.detail.runs, evidence: m.detail.evidence, diff: m.diff, reviews: withReviews ? m.reviews.map((r: { at: string }) => ({ ...r, at: Date.parse(r.at) })) : undefined, now: Date.parse(pack.recordedAt) })
}

describe('evidence graph', () => {
  it('reconstructs the repair journey from recorded facts', () => {
    const g = graphOf('repair')
    expect(g.counts.stage).toBe(7)
    expect(g.counts.run).toBe(5)
    expect(g.counts.revision).toBe(3)
    expect(g.nodes.filter((n) => n.kind === 'finding').map((n) => n.finding!.severity)).toEqual(['blocker', 'major', 'nit', 'nit'])
    const pricing = g.byId.get('file:src/pricing.js')!
    expect(pricing.file!.planned).toBe(true)
    expect(pricing.file!.edits).toBe(2)
    expect(pricing.file!.diff).toMatchObject({ additions: 2, deletions: 1 })
    // The blocker was raised in review 1, but the latest review does not block the file.
    expect(pricing.status).toBe('idle')
    expect(g.byId.get('decision')!.decision!.allowed).toBe(true)
  })

  it('labels how every edge is known', () => {
    const g = graphOf('repair')
    const basis = (kind: string) => new Set(g.edges.filter((e) => e.kind === kind).map((e) => e.basis))
    expect(basis('tested')).toEqual(new Set(['observed']))
    expect(basis('parent')).toEqual(new Set(['derived']))
    expect(basis('produced')).toEqual(new Set(['derived']))
    expect(basis('planned')).toEqual(new Set(['planned']))
  })

  it('binds each check to the revision it ran on', () => {
    const g = graphOf('repair')
    for (const e of g.edges.filter((x) => x.kind === 'tested')) {
      const check = g.byId.get(e.from)!
      expect(e.to).toBe(`rev:${check.evidence!.commitSha.slice(0, 7)}`)
    }
  })

  it('reports the engine refusal for a failing check', () => {
    const d = graphOf('verify-fail').byId.get('decision')!
    expect(d.status).toBe('blocked')
    expect(d.decision!.allowed).toBe(false)
    expect(d.decision!.unresolved.join(' ')).toMatch(/npm run test/)
  })

  it('never shows outcomes before they were recorded', () => {
    const g = graphOf('repair')
    // Cut just before the first review was recorded: its findings must not exist yet.
    const firstReview = Math.min(...g.nodes.filter((n) => n.kind === 'finding').map((n) => n.at!))
    const before = projectAt(g, firstReview - 1)
    expect(before.nodes.some((n) => n.kind === 'finding')).toBe(false)
    expect(before.nodes.find((n) => n.id === 'stage:review:1')!.status).toBe('running')
    expect(before.nodes.some((n) => n.kind === 'file' && n.file!.diff)).toBe(false)
    expect(before.byId.has('decision')).toBe(false)
  })

  it('says what is missing instead of inventing it', () => {
    const g = graphOf('repair', false)
    expect(g.gaps.join(' ')).toMatch(/earlier review record/)
    expect(g.nodes.filter((n) => n.kind === 'finding')).toHaveLength(1)
    expect(graphOf('clean').gaps.join(' ')).toMatch(/workspace was removed/)
  })

  it('collapses repeated snapshots into distinct reviews', () => {
    const m = pack.missions.find((x: { scenario: string }) => x.scenario === 'repair')
    const task = m.detail.task
    const snaps = [{ at: 1, task: { ...task, review: m.reviews[0].review, reviewedSha: 'a' } }, { at: 2, task: { ...task, review: m.reviews[0].review, reviewedSha: 'a' } }, { at: 3, task: { ...task, review: m.reviews[1].review, reviewedSha: 'b' } }]
    expect(reviewsFromSnapshots(snaps)).toHaveLength(2)
  })

  it('only treats file reads and edits as file targets', () => {
    expect(fileTarget({ at: '', tool: 'Read', target: './src\\a.ts', kind: 'read' })).toBe('src/a.ts')
    expect(fileTarget({ at: '', tool: 'Glob', target: 'src/**/*.js', kind: 'search' })).toBeNull()
    expect(fileTarget({ at: '', tool: 'Bash', target: 'npm test', kind: 'command' })).toBeNull()
  })
})
