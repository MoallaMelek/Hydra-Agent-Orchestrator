import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Assignment, Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptedStep } from './agents/scripted.js'
import type { AgentRunRequest } from './agents/types.js'
import { BUGGY_NODE_PROJECT, cleanup, FIXED_MATH, gitIn, makeRepo, tempDir } from './testing/fixtures.js'

// Reliability under concurrency and failure (COMMERCIAL_READINESS: reliability stress tests).

const ALL: Assignment = { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' }
const PLAN = { summary: 'plan', steps: ['do it'], acceptanceCriteria: ['tests pass'], risks: [], filesLikelyTouched: [] }
const APPROVE = { verdict: 'approve', summary: 'ok', findings: [], acceptanceCriteriaMet: [{ criterion: 'tests pass', met: true, note: '' }] }
const IMPL = { summary: 'done', followUps: [] }
const ANSWER = { answer: 'answer', keyFindings: [], filesReferenced: [] }

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

/** Implementer output chosen by a marker in the task prompt, e.g. "[A]". */
function byMarker(files: Record<string, Record<string, string>>) {
  return new ScriptedAdapter((request: AgentRunRequest): ScriptedStep => {
    if (request.role === 'planner') return { structured: PLAN }
    if (request.role === 'reviewer') return { structured: APPROVE }
    const marker = Object.keys(files).find((m) => request.prompt.includes(`[${m}]`))
    return { files: marker ? files[marker] : {}, structured: IMPL }
  })
}

async function setup(adapter: ScriptedAdapter, project: Record<string, string> = BUGGY_NODE_PROJECT, maxConcurrentAgents = 3) {
  const dataDir = tempDir('hydra-rel-')
  const repo = makeRepo(project)
  dirs.push(dataDir, repo)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([adapter]), skipProbe: true, maxConcurrentAgents })
  engines.push(engine)
  const added = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  return { engine, repo, projectId: added.result.id }
}

async function create(engine: Engine, projectId: string, prompt: string, over: Record<string, unknown> = {}): Promise<Task> {
  const ack = await engine.execute({ type: 'task.create', projectId, prompt, intent: 'change', mode: 'developer', assignment: ALL, ...over })
  if (!ack.ok) throw new Error(ack.error.message)
  return ack.result as Task
}

async function until(engine: Engine, taskId: string, predicate: (t: Task) => boolean, ms = 60_000): Promise<Task> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const t = engine.store.getTask(taskId)!
    if (predicate(t)) return t
    await new Promise((r) => setTimeout(r, 50))
  }
  const t = engine.store.getTask(taskId)
  throw new Error(`Timed out: ${t?.status} at ${t?.stage}: ${t?.error}`)
}

const ready = (t: Task) => t.status === 'waiting_input' && t.waitReason === 'final_approval'
const accept = (engine: Engine, t: Task) => engine.execute({ type: 'task.decide', taskId: t.id, decision: 'accept', headSha: t.workspace!.headSha! })

describe('reliability', () => {
  it('runs two tasks on one project concurrently and applies both multi-file changes', async () => {
    const { engine, repo, projectId } = await setup(byMarker({
      A: { 'math.js': FIXED_MATH },
      B: { 'docs/GUIDE.md': '# Guide\n', 'lib/helper.js': 'module.exports = () => 1\n', 'lib/nested/deep.js': 'module.exports = 2\n' }
    }))
    const [a, b] = await Promise.all([create(engine, projectId, '[A] fix add'), create(engine, projectId, '[B] add docs and helpers')])
    const [readyA, readyB] = await Promise.all([until(engine, a.id, ready), until(engine, b.id, ready)])
    expect((await engine.taskDiff(b.id)).files.map((f) => f.path).sort()).toEqual(['docs/GUIDE.md', 'lib/helper.js', 'lib/nested/deep.js'])

    // Accept both at the same moment: the repository lock serialises them.
    const acks = await Promise.all([accept(engine, readyA), accept(engine, readyB)])
    expect(acks.every((ack) => ack.ok)).toBe(true)
    // One applies directly; the other sees a moved branch, integrates, re-verifies and asks again.
    const settled = await Promise.all([a, b].map((t) => until(engine, t.id, (x) => x.status === 'completed' || (ready(x) && x.workspace!.headSha !== (t.id === a.id ? readyA : readyB).workspace!.headSha))))
    for (const t of settled.filter((x) => x.status !== 'completed')) {
      expect(t.error).toMatch(/integrated/)
      await accept(engine, t)
      await until(engine, t.id, (x) => x.status === 'completed')
    }
    expect(readFileSync(join(repo, 'math.js'), 'utf8')).toContain('a + b')
    expect(readFileSync(join(repo, 'lib/nested/deep.js'), 'utf8')).toBe('module.exports = 2\n')
    expect(gitIn(repo, 'status', '--porcelain')).toBe('')
    expect(gitIn(repo, 'branch', '--list', 'hydra/*')).toBe('')
  })

  it('refuses a conflicting second change without touching the user branch', async () => {
    const { engine, repo, projectId } = await setup(byMarker({
      A: { 'math.js': FIXED_MATH },
      B: { 'math.js': 'function add(a, b) {\n  return b + a // commutative\n}\nmodule.exports = { add }\n' }
    }))
    const [a, b] = await Promise.all([create(engine, projectId, '[A] fix'), create(engine, projectId, '[B] fix differently')])
    const [readyA, readyB] = await Promise.all([until(engine, a.id, ready), until(engine, b.id, ready)])
    await accept(engine, readyA)
    await until(engine, a.id, (t) => t.status === 'completed')
    const head = gitIn(repo, 'rev-parse', 'HEAD')

    await accept(engine, readyB)
    const refused = await until(engine, b.id, (t) => ready(t) && Boolean(t.error))
    expect(refused.error).toMatch(/conflict/i)
    expect(refused.workspace!.headSha).toBe(readyB.workspace!.headSha) // task branch unchanged
    expect(gitIn(repo, 'rev-parse', 'HEAD')).toBe(head) // user branch unchanged
    expect(gitIn(repo, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(repo, 'math.js'), 'utf8')).toBe(FIXED_MATH)
    // The user can still discard the refused task cleanly.
    await engine.execute({ type: 'task.decide', taskId: b.id, decision: 'reject' })
    const discarded = await until(engine, b.id, (t) => t.status === 'completed')
    expect(discarded.outcome).toBe('discarded')
    expect(existsSync(refused.workspace!.path)).toBe(false)
  })

  it('completes a burst of twelve tasks with three agent slots and no database errors', async () => {
    const adapter = new ScriptedAdapter(() => ({ structured: ANSWER, delayMs: 30 }))
    const { engine, projectId } = await setup(adapter, { 'a.txt': 'a' }, 3)
    const tasks = await Promise.all(Array.from({ length: 12 }, (_, i) => create(engine, projectId, `question ${i}`, { intent: 'analyze', mode: 'safe' })))
    const done = await Promise.all(tasks.map((t) => until(engine, t.id, (x) => x.status === 'completed' || x.status === 'failed')))
    expect(done.map((t) => t.status)).toEqual(Array(12).fill('completed'))
    expect(adapter.calls).toHaveLength(12)
  })

  it('records a check that cannot start as evidence instead of failing the engine', async () => {
    const checks = JSON.stringify({ checks: [{ label: 'missing tool', kind: 'test', argv: ['hydra-no-such-binary-xyz', '--run'] }] })
    const { engine, projectId } = await setup(byMarker({ A: { 'math.js': FIXED_MATH } }), { ...BUGGY_NODE_PROJECT, '.hydra/checks.json': checks })
    const task = await create(engine, projectId, '[A] fix')
    const settled = await until(engine, task.id, (t) => ready(t) || t.status === 'failed' || t.status === 'paused')
    const verify = engine.store.listEvidence(task.id).filter((e) => e.phase === 'verify')
    expect(verify.length).toBeGreaterThan(0)
    expect(verify.every((e) => e.exitCode !== 0)).toBe(true)
    expect(settled.status).not.toBe('running')
    // The engine is still healthy: another task can be created.
    expect((await engine.execute({ type: 'task.create', projectId, prompt: 'still alive?', intent: 'analyze', mode: 'safe', assignment: ALL })).ok).toBe(true)
  })
})
