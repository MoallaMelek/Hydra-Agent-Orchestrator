import { afterEach, describe, expect, it } from 'vitest'
import type { Outcome, Task } from '@hydra/protocol'
import { Engine } from '../engine.js'
import { AdapterRegistry } from '../agents/registry.js'
import { ScriptedAdapter } from '../agents/scripted.js'
import { recommend } from './outcomes.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from '../testing/fixtures.js'

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

let seq = 0
const outcome = (strategy: string, ok: boolean, minutes = 5, category = 'change/normal'): Outcome => ({
  taskId: `t${++seq}`, at: new Date().toISOString(), category, strategy, durationMs: minutes * 60_000, tokens: 1000, costUsd: 0.5,
  verified: ok, fixRounds: ok ? 0 : 2, decision: ok ? 'accepted' : 'rejected', failure: null
})

describe('agent recommendation', () => {
  it('uses a stated rule when there is no history', () => {
    const both = recommend('change/normal', ['claude', 'codex'], [])
    expect(both).toMatchObject({ strategy: 'claude→codex→claude', basis: 'rule' })
    expect(both.reason).toMatch(/more independent/)
    expect(recommend('change/normal', ['codex'], [])).toMatchObject({ strategy: 'codex→codex→codex', basis: 'rule' })
    expect(recommend('answer/fast', ['claude', 'codex'], [])).toMatchObject({ strategy: 'claude', basis: 'rule' })
    expect(recommend('answer/fast', ['codex'], [])).toMatchObject({ strategy: 'codex' })
  })

  it('switches to what actually worked once there are enough similar tasks, and shows the counts', () => {
    const history = [
      ...Array.from({ length: 6 }, () => outcome('codex→claude→codex', true, 4)),
      ...Array.from({ length: 5 }, (_, i) => outcome('claude→codex→claude', i < 2, 6))
    ]
    const r = recommend('change/normal', ['claude', 'codex'], history)
    expect(r).toMatchObject({ strategy: 'codex→claude→codex', basis: 'history', assignment: { planner: 'codex', implementer: 'claude', reviewer: 'codex' } })
    expect(r.reason).toMatch(/last 6 similar tasks .* succeeded 6 times/)
    expect(r.evidence.find((e) => e.strategy === 'claude→codex→claude')).toMatchObject({ n: 5, succeeded: 2 })
  })

  it('does not let a handful of observations override the rule', () => {
    const history = Array.from({ length: 4 }, () => outcome('codex→codex→codex', true))
    expect(recommend('change/normal', ['claude', 'codex'], history)).toMatchObject({ basis: 'rule', strategy: 'claude→codex→claude' })
  })

  it('ignores other kinds of task and unavailable providers', () => {
    const history = Array.from({ length: 8 }, () => outcome('codex→codex→codex', true, 3, 'change/high'))
    expect(recommend('change/normal', ['claude', 'codex'], history).basis).toBe('rule')
    expect(recommend('change/high', ['claude'], history)).toMatchObject({ strategy: 'claude→claude→claude', basis: 'rule' })
  })
})

describe('local outcome records', () => {
  it('records finished tasks without their content, and can be cleared', async () => {
    const dataDir = tempDir('hydra-outcomes-')
    const repo = makeRepo(BUGGY_NODE_PROJECT)
    dirs.push(dataDir, repo)
    const engine = await Engine.open({ dataDir, skipProbe: true, registry: new AdapterRegistry([new ScriptedAdapter(() => ({ text: 'a secret answer about add()' }))]) })
    engines.push(engine)
    const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt: 'PRIVATE PROMPT TEXT', depth: 'standard', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    const id = (ack as { result: Task }).result.id
    for (let i = 0; i < 200 && engine.store.getTask(id)!.status !== 'completed'; i++) await new Promise((r) => setTimeout(r, 25))
    const [recorded] = engine.store.listOutcomes()
    expect(recorded).toMatchObject({ taskId: id, category: 'answer/standard', strategy: 'scripted', decision: 'answered', verified: null })
    expect(JSON.stringify(recorded)).not.toMatch(/PRIVATE PROMPT|secret answer/)
    expect(await engine.execute({ type: 'outcomes.get' })).toMatchObject({ ok: true, result: { count: 1 } })
    expect(await engine.execute({ type: 'outcomes.clear' })).toMatchObject({ ok: true, result: { removed: 1 } })
    expect(engine.store.listOutcomes()).toHaveLength(0)
  })
})
