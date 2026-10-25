import { describe, expect, it } from 'vitest'
import type { Review } from '@hydra/protocol'
import { buildTrace, domainEnd, filesOf } from './model'
import { FixtureWorld } from '../lab/world'

// The trace is built only from engine data; these cases use the fixture world, which
// produces the same shapes the engine publishes (simulated content).

function world() {
  const w = new FixtureWorld()
  const project = w.addProject('shop-api')
  const task = w.createTask(project.id, 'Cart totals ignore quantity.')
  const step = (ms: number) => { w.now += ms }
  const trace = (slots = { busy: 0, limit: 3 }) => buildTrace({ task: w.tasks.get(task.id)!, runs: [...w.runs.values()], evidence: w.evidence, slots, now: w.now })
  return { w, id: task.id, step, trace }
}

const APPROVE: Review = { verdict: 'approve', summary: 'ok', findings: [], acceptanceCriteriaMet: [] }

function agent(w: FixtureWorld, id: string, stage: 'plan' | 'implement' | 'fix' | 'review', role: 'planner' | 'implementer' | 'reviewer', provider: 'claude' | 'codex', ms: number, tools: Array<[string, string]> = []) {
  const run = w.startRun(id, stage, role, provider)
  for (const [tool, target] of tools) { w.now += ms / (tools.length + 1); w.tool(run.id, tool, target) }
  w.now += ms / (tools.length + 1)
  w.endRun(run.id)
  return run
}

describe('Relay trace', () => {
  it('lays a full change out on five lanes, hands each artifact on, and ends at your decision', () => {
    const { w, id, step, trace } = world()
    w.beginStage(id, 'plan'); agent(w, id, 'plan', 'planner', 'claude', 4000, [['Read', 'src/cart.js']]); w.endStage(id, 'succeeded', 'Plan: 4 steps')
    w.beginStage(id, 'implement'); agent(w, id, 'implement', 'implementer', 'codex', 6000, [['edit', 'src/cart.js']]); w.commit(id, 2); w.endStage(id, 'succeeded', 'Commit 0000000200')
    w.beginStage(id, 'review'); step(800); w.check(id, 'npm test', 'pre_review', 0, 800); agent(w, id, 'review', 'reviewer', 'claude', 3000); w.setReview(id, APPROVE); w.endStage(id, 'succeeded', 'Approved')
    w.beginStage(id, 'verify'); step(900); w.check(id, 'npm test', 'verify', 0, 900); w.endStage(id, 'succeeded', 'Required checks passed')
    w.beginStage(id, 'demo'); step(500); w.check(id, 'npm test', 'demo_base', 1, 500); step(500); w.check(id, 'npm test', 'demo_final', 0, 500); w.endStage(id, 'succeeded', 'Before → after: 1/1 pass')
    w.update(id, (t) => { t.status = 'waiting_input'; t.waitReason = 'final_approval'; t.stage = 'approval' })
    step(10_000)
    const tr = trace()

    expect(tr.lanes.map((l) => l.id)).toEqual(['you', 'planner', 'implementer', 'reviewer', 'hydra'])
    expect(tr.lanes.find((l) => l.id === 'implementer')!.actor).toBe('Codex CLI')
    const runs = tr.segments.filter((s) => s.kind === 'run')
    expect(runs.map((s) => s.lane)).toEqual(['planner', 'implementer', 'reviewer'])
    expect(runs.every((s) => s.basis === 'observed' && s.status === 'ok')).toBe(true)
    expect(runs[0]!.ticks).toHaveLength(1)
    expect(tr.segments.filter((s) => s.kind === 'check')).toHaveLength(4)
    expect(tr.batons.map((b) => `${b.kind}:${b.lane}→${b.to}`)).toEqual([
      'request:you→planner', 'plan:planner→implementer', 'changes:implementer→reviewer', 'review:reviewer→hydra', 'checks:hydra→null', 'demo:hydra→you'
    ])
    const gate = tr.segments.find((s) => s.kind === 'gate')!
    expect(gate).toMatchObject({ lane: 'you', status: 'waiting', end: null, basis: 'observed' })
    expect(tr.headline).toMatchObject({ text: 'Waiting for you: review the verified result', tone: 'you' })
    expect(tr.repairRounds).toBe(0)
  })

  it('shows the repair cycle: a rejected review and a failed verification each send work back to the implementer', () => {
    const { w, id, step, trace } = world()
    w.beginStage(id, 'plan'); agent(w, id, 'plan', 'planner', 'claude', 3000); w.endStage(id, 'succeeded', 'Plan: 2 steps')
    w.beginStage(id, 'implement'); agent(w, id, 'implement', 'implementer', 'codex', 3000); w.endStage(id, 'succeeded', 'Commit a')
    w.beginStage(id, 'review'); agent(w, id, 'review', 'reviewer', 'claude', 3000); w.endStage(id, 'succeeded', 'Changes requested: 2 findings')
    w.beginStage(id, 'fix'); agent(w, id, 'fix', 'implementer', 'codex', 3000); w.endStage(id, 'succeeded', 'Commit b')
    w.beginStage(id, 'review'); agent(w, id, 'review', 'reviewer', 'claude', 3000); w.endStage(id, 'succeeded', 'Approved')
    w.beginStage(id, 'verify'); step(900); w.check(id, 'npm test', 'verify', 1, 900); w.endStage(id, 'succeeded', '1 required check failed')
    w.beginStage(id, 'fix'); agent(w, id, 'fix', 'implementer', 'codex', 3000)
    const tr = trace()

    const repairs = tr.batons.filter((b) => b.kind === 'repair')
    expect(repairs.map((b) => [b.lane, b.to, b.tone, b.label])).toEqual([
      ['reviewer', 'implementer', 'bad', 'Changes requested: 2 findings'],
      ['hydra', 'implementer', 'bad', '1 required check failed']
    ])
    expect(tr.segments.filter((s) => s.kind === 'run' && s.stage === 'fix').map((s) => s.label)).toEqual(['Fix 1 · Codex CLI', 'Fix 2 · Codex CLI'])
    expect(tr.segments.filter((s) => s.kind === 'check')[0]!.status).toBe('failed')
    expect(tr.repairRounds).toBe(2)
  })

  it('says which agent is working on what, and the last tool call it reported (independent review R5)', () => {
    const { w, id, trace } = world()
    w.beginStage(id, 'implement')
    const run = w.startRun(id, 'implement', 'implementer', 'codex')
    w.tool(run.id, 'Read', 'src/cart.js'); w.tool(run.id, 'edit', 'src/cart.js, test/cart.test.js')
    w.now += 2000
    const tr = trace()
    // A reported call may already be over: it is the last one reported, not "what it is doing now".
    expect(tr.headline).toMatchObject({ text: 'Codex CLI is implementing the plan', tone: 'accent', basis: 'observed', last: { text: 'edited src/cart.js, test/cart.test.js' } })
    const seg = tr.segments.find((s) => s.kind === 'run')!
    expect(seg).toMatchObject({ status: 'running', end: null })
    expect(seg.ticks.map((x) => x.kind)).toEqual(['read', 'edit'])
    expect(tr.live).toBe(true)
  })

  it('marks waiting for an agent slot as inferred, and only when every slot is busy', () => {
    const { w, id, trace } = world()
    w.beginStage(id, 'plan')
    w.now += 4000
    const full = trace({ busy: 3, limit: 3 })
    const wait = full.segments.find((s) => s.kind === 'wait')!
    expect(wait).toMatchObject({ lane: 'planner', basis: 'inferred', label: 'Waiting for a free agent slot (3/3 in use)', end: null })
    expect(full.headline.basis).toBe('inferred')
    expect(trace({ busy: 1, limit: 3 }).segments.find((s) => s.kind === 'wait')!.label).toBe('Starting the agent')
  })

  it('shows plan approval as your gate, open while it waits', () => {
    const { w, id, trace } = world()
    w.beginStage(id, 'plan'); agent(w, id, 'plan', 'planner', 'claude', 3000); w.endStage(id, 'succeeded', 'Plan: 3 steps')
    w.update(id, (t) => { t.status = 'waiting_input'; t.waitReason = 'plan_approval' })
    w.now += 5000
    const tr = trace()
    expect(tr.segments.find((s) => s.kind === 'gate')).toMatchObject({ label: 'Waiting for you: approve the plan', status: 'waiting', end: null })
    expect(tr.batons.find((b) => b.kind === 'plan')!.to).toBe('you')
    expect(tr.headline.tone).toBe('you')
  })

  it('keeps a stable scale while live, so the drawing does not rescale every second', () => {
    const start = 0
    expect(domainEnd(start, 10_000, true)).toBe(15_000)
    expect(domainEnd(start, 50_000, true)).toBe(60_000)
    expect(domainEnd(start, 52_000, true)).toBe(60_000)
    expect(domainEnd(start, 70_000, true)).toBe(90_000)
    expect(domainEnd(start, 70_000, false)).toBe(70_000)
  })

  it('lists files the agent inspected and modified, most recent first', () => {
    const at = '2026-10-16T09:00:00Z'
    expect(filesOf([
      { at, tool: 'Read', target: 'a.ts', kind: 'read' }, { at, tool: 'edit', target: 'a.ts, b.ts', kind: 'edit' },
      { at, tool: 'shell', target: 'npm test → exit 0', kind: 'command' }, { at, tool: 'Read', target: 'c.ts', kind: 'read' }
    ])).toEqual({ inspected: ['c.ts', 'a.ts'], modified: ['a.ts', 'b.ts'], commands: ['npm test → exit 0'] })
  })
})
