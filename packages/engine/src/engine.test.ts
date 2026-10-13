import { readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Assignment, Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptHandler } from './agents/scripted.js'
import { BUGGY_NODE_PROJECT, cleanup, FIXED_MATH, gitIn, makeRepo, tempDir } from './testing/fixtures.js'

const PLAN = { summary: 'Fix add()', steps: ['Change subtraction to addition'], acceptanceCriteria: ['add(2,3) === 5'], risks: [], filesLikelyTouched: ['math.js'] }
const APPROVE = { verdict: 'approve', summary: 'Looks right', findings: [], acceptanceCriteriaMet: [{ criterion: 'add(2,3) === 5', met: true, note: '' }] }
const REJECT = { verdict: 'changes_requested', summary: 'Still wrong', findings: [{ severity: 'major', file: 'math.js', issue: 'add still subtracts', suggestion: 'use +' }], acceptanceCriteriaMet: [] }
const IMPL = { summary: 'done', followUps: [] }
const ALL: Assignment = { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' }

const cleanupDirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...cleanupDirs.splice(0))
})

/** Default behaviour: plan → correct fix → approve. Override per role. */
function script(over: Partial<Record<'planner' | 'implementer' | 'reviewer', ScriptHandler>> = {}): ScriptedAdapter {
  return new ScriptedAdapter((request, call) => {
    const handler = over[request.role]
    if (handler) return handler(request, call)
    if (request.role === 'planner') return { structured: PLAN, usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 } }
    if (request.role === 'implementer') return { files: { 'math.js': FIXED_MATH }, structured: IMPL, usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.02 } }
    return { structured: APPROVE, usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 } }
  })
}

async function setup(adapter: ScriptedAdapter, dataDir = tempDir('hydra-engine-')) {
  const repo = makeRepo(BUGGY_NODE_PROJECT)
  cleanupDirs.push(repo, dataDir)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([adapter]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  return { engine, repo, dataDir, projectId: project.result.id }
}

async function create(engine: Engine, projectId: string, over: Record<string, unknown> = {}): Promise<Task> {
  const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'Fix add() so tests pass', intent: 'change', mode: 'developer', assignment: ALL, ...over })
  if (!ack.ok) throw new Error(ack.error.message)
  return ack.result as Task
}

async function until(engine: Engine, taskId: string, predicate: (t: Task) => boolean, ms = 120_000): Promise<Task> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const t = engine.store.getTask(taskId)!
    if (predicate(t)) return t
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`Timed out; task is ${JSON.stringify(engine.store.getTask(taskId)?.status)} at ${engine.store.getTask(taskId)?.stage}: ${engine.store.getTask(taskId)?.error}`)
}

const waiting = (t: Task) => t.status === 'waiting_input'

describe('engine lifecycle', () => {
  it('refuses a stale accept and re-asks after integrating a moved branch', async () => {
    const { engine, repo, projectId } = await setup(script())
    const task = await create(engine, projectId)
    const ready = await until(engine, task.id, waiting)
    const reviewed = ready.workspace!.headSha!
    expect(await engine.execute({ type: 'task.decide', taskId: task.id, decision: 'accept', headSha: 'b'.repeat(40) })).toMatchObject({ ok: false, error: { code: 'conflict' } })

    // The user commits something unrelated before accepting.
    writeFileSync(join(repo, 'NOTES.md'), 'user notes\n')
    gitIn(repo, 'add', 'NOTES.md')
    gitIn(repo, 'commit', '-qm', 'user notes')
    await engine.execute({ type: 'task.decide', taskId: task.id, decision: 'accept', headSha: reviewed })
    const again = await until(engine, task.id, (t) => waiting(t) && t.workspace!.headSha !== reviewed)
    expect(again.error).toMatch(/integrated them and all checks pass/)
    expect(readFileSync(join(repo, 'math.js'), 'utf8')).toContain('a - b') // still nothing applied
    expect(engine.store.listEvidence(task.id).filter((e) => e.phase === 'verify' && e.commitSha === again.workspace!.headSha).at(-1)!.exitCode).toBe(0)

    await engine.execute({ type: 'task.decide', taskId: task.id, decision: 'accept', headSha: again.workspace!.headSha! })
    const done = await until(engine, task.id, (t) => t.status === 'completed')
    expect(done.applied!.method).toBe('fast_forward')
    expect(readFileSync(join(repo, 'math.js'), 'utf8')).toContain('a + b')
    expect(readFileSync(join(repo, 'NOTES.md'), 'utf8')).toBe('user notes\n')
  })

  it('safe mode refuses to run checks whose definitions the agent changed after approval', async () => {
    const adapter = script({ implementer: () => ({ files: { 'math.js': FIXED_MATH, 'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node -e "process.exit(0)"' } }) }, structured: IMPL }) })
    const { engine, projectId } = await setup(adapter)
    const task = await create(engine, projectId, { mode: 'safe' })
    await until(engine, task.id, (t) => waiting(t) && t.waitReason === 'plan_approval')
    await engine.execute({ type: 'task.approve_plan', taskId: task.id, approve: true })
    const ready = await until(engine, task.id, (t) => waiting(t) && t.waitReason === 'final_approval')
    const verify = engine.store.listEvidence(task.id).filter((e) => e.phase === 'verify')
    expect(verify.length).toBeGreaterThan(0)
    expect(verify.every((e) => e.spawnError?.includes('definitions changed after approval'))).toBe(true)
    expect(ready.demo!.deltas[0]!.after).toBe('error')
  })

  it('allows only one engine per data directory (different process)', async () => {
    const { dataDir } = await setup(script())
    const lock = JSON.parse(readFileSync(join(dataDir, 'engine.lock'), 'utf8')) as { pid: number }
    expect(lock.pid).toBe(process.pid)
    // A live foreign PID holding the lock blocks a second engine.
    writeFileSync(join(dataDir, 'engine.lock'), JSON.stringify({ pid: process.ppid, host: hostname() }))
    await expect(Engine.open({ dataDir, registry: new AdapterRegistry([script()]), skipProbe: true })).rejects.toThrow(/already using this data directory/)
    writeFileSync(join(dataDir, 'engine.lock'), JSON.stringify({ pid: process.pid, host: hostname() }))
  })

  it('runs PLAN→IMPLEMENT→REVIEW→VERIFY→DEMO→APPROVAL, applies only on accept, and rolls back', async () => {
    const { engine, repo, projectId } = await setup(script())
    const task = await create(engine, projectId)
    const ready = await until(engine, task.id, waiting)

    expect(ready.waitReason).toBe('final_approval')
    expect(ready.stages.map((s) => `${s.stage}:${s.status}`)).toEqual(['plan:succeeded', 'implement:succeeded', 'review:succeeded', 'verify:succeeded', 'demo:succeeded'])
    // User tree untouched until the human decides.
    expect(readFileSync(join(repo, 'math.js'), 'utf8')).toContain('a - b')

    const evidence = engine.store.listEvidence(task.id)
    const verify = evidence.filter((e) => e.phase === 'verify')
    expect(verify).toHaveLength(1)
    expect(verify[0]!.exitCode).toBe(0)
    expect(verify[0]!.commitSha).toBe(ready.workspace!.headSha)
    expect(ready.demo!.deltas).toEqual([{ checkId: expect.any(String), label: 'npm run test', before: 'fail', after: 'pass' }])
    expect(ready.usage.costUsd).toBeCloseTo(0.04)
    expect(ready.usage.agentRuns).toBe(3)

    const diff = await engine.taskDiff(task.id)
    expect(diff.files.map((f) => f.path)).toEqual(['math.js'])

    expect(await engine.execute({ type: 'task.decide', taskId: task.id, decision: 'accept' })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect((await engine.execute({ type: 'task.decide', taskId: task.id, decision: 'accept', headSha: ready.workspace!.headSha! })).ok).toBe(true)
    const applied = await until(engine, task.id, (t) => t.status === 'completed')
    expect(applied.outcome).toBe('applied')
    expect(readFileSync(join(repo, 'math.js'), 'utf8')).toContain('a + b')
    expect(gitIn(repo, 'branch', '--list', 'hydra/*')).toBe('')

    const rolled = await engine.execute({ type: 'task.rollback', taskId: task.id })
    expect(rolled.ok).toBe(true)
    expect(readFileSync(join(repo, 'math.js'), 'utf8')).toContain('a - b')
    expect(engine.store.getTask(task.id)!.outcome).toBe('rolled_back')
  })

  it('safe mode stops for plan approval before any agent can write, and rejection discards cleanly', async () => {
    const adapter = script()
    const { engine, repo, projectId } = await setup(adapter)
    const task = await create(engine, projectId, { mode: 'safe' })
    const paused = await until(engine, task.id, waiting)
    expect(paused.waitReason).toBe('plan_approval')
    expect(paused.checksApproved).toBe(false)
    expect(paused.checks.map((c) => c.label)).toEqual(['npm run test'])
    expect(adapter.calls.map((c) => c.access)).toEqual(['read'])

    await engine.execute({ type: 'task.approve_plan', taskId: task.id, approve: false })
    const done = await until(engine, task.id, (t) => t.status === 'completed')
    expect(done.outcome).toBe('discarded')
    expect(done.workspace!.removed).toBe(true)
    expect(gitIn(repo, 'branch', '--list', 'hydra/*')).toBe('')
  })

  it('loops review→fix with real failing evidence and stops at the fix budget', async () => {
    let implCalls = 0
    const adapter = script({
      implementer: () => ({ files: { 'math.js': ++implCalls === 1 ? 'function add(a,b){return a*b}\nmodule.exports={add}\n' : FIXED_MATH }, structured: IMPL }),
      reviewer: (_req, call) => ({ structured: call <= 3 ? REJECT : APPROVE })
    })
    const { engine, projectId } = await setup(adapter)
    const task = await create(engine, projectId)
    const ready = await until(engine, task.id, waiting)
    expect(ready.fixRound).toBe(1)
    const fixPrompt = adapter.calls.find((c, i) => c.role === 'implementer' && i > 1)!.prompt
    expect(fixPrompt).toContain('add still subtracts')
    expect(fixPrompt).toContain('FAILED') // the pre-review evidence showed the failing test
    expect(engine.store.listEvidence(task.id).filter((e) => e.phase === 'verify').at(-1)!.exitCode).toBe(0)
  })

  it('request_changes feeds the human note to the implementer and returns to approval', async () => {
    const adapter = script()
    const { engine, projectId } = await setup(adapter)
    const task = await create(engine, projectId)
    await until(engine, task.id, waiting)
    await engine.execute({ type: 'task.decide', taskId: task.id, decision: 'request_changes', feedback: 'Also add a comment explaining add()' })
    const again = await until(engine, task.id, (t) => waiting(t) && t.fixRound === 1)
    expect(again.waitReason).toBe('final_approval')
    expect(adapter.calls.at(-2)!.prompt).toContain('Also add a comment explaining add()')
  })

  it('cancels a running agent promptly and keeps the workspace for inspection', async () => {
    const { engine, projectId } = await setup(script({ implementer: () => ({ delayMs: 60_000, structured: IMPL }) }))
    const task = await create(engine, projectId)
    await until(engine, task.id, (t) => t.stage === 'implement' && t.status === 'running')
    await new Promise((r) => setTimeout(r, 100))
    const started = Date.now()
    await engine.execute({ type: 'task.cancel', taskId: task.id })
    const canceled = await until(engine, task.id, (t) => t.status === 'canceled', 5000)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(canceled.workspace!.removed).toBe(false)
    expect(engine.store.listRuns(task.id).at(-1)!.status).toBe('canceled')
  })

  it('pauses (not fails) when the provider reports a usage limit, and resumes later', async () => {
    let limited = true
    const { engine, projectId } = await setup(script({ implementer: () => (limited
      ? { fail: "You've hit your usage limit. Try again at 6:46 AM." }
      : { files: { 'math.js': FIXED_MATH }, structured: IMPL }) }))
    const task = await create(engine, projectId)
    const paused = await until(engine, task.id, (t) => t.status === 'paused')
    expect(paused.error).toMatch(/not accepting work right now/)
    expect(paused.plan).not.toBeNull()
    limited = false
    await engine.execute({ type: 'task.resume', taskId: task.id })
    const ready = await until(engine, task.id, waiting)
    expect(ready.stages.filter((s) => s.stage === 'plan')).toHaveLength(1)
  })

  it('pauses running tasks when the engine shuts down, so they can be resumed', async () => {
    const dataDir = tempDir('hydra-shutdown-')
    const { engine, projectId } = await setup(script({ implementer: () => ({ delayMs: 60_000, structured: IMPL }) }), dataDir)
    const task = await create(engine, projectId)
    await until(engine, task.id, (t) => t.stage === 'implement' && t.status === 'running')
    await engine.close()
    engines.splice(engines.indexOf(engine), 1)
    const reopened = await Engine.open({ dataDir, registry: new AdapterRegistry([script()]), skipProbe: true })
    engines.push(reopened)
    const paused = reopened.store.getTask(task.id)!
    expect(paused.status).toBe('paused')
    expect(paused.error).toMatch(/Hydra was closed/)
    await reopened.execute({ type: 'task.resume', taskId: task.id })
    await until(reopened, task.id, waiting)
  })

  it('enforces the cost budget using reported usage', async () => {
    const { engine, projectId } = await setup(script({ implementer: () => ({ files: { 'math.js': FIXED_MATH }, structured: IMPL, usage: { inputTokens: 10, outputTokens: 10, costUsd: 9 } }) }))
    const task = await create(engine, projectId, { budget: { maxCostUsd: 1 } })
    const failed = await until(engine, task.id, (t) => t.status === 'failed')
    expect(failed.error).toMatch(/Budget limit reached: Cost limit exceeded/)
  })

  it('recovers after a crash: interrupted work becomes paused and resumes from the interrupted stage', async () => {
    const dataDir = tempDir('hydra-crash-')
    const hang = new ScriptedAdapter((req) => (req.role === 'implementer' ? new Promise(() => {}) : req.role === 'planner' ? { structured: PLAN } : { structured: APPROVE }))
    const first = await setup(hang, dataDir)
    const task = await create(first.engine, first.projectId)
    await until(first.engine, task.id, (t) => t.stage === 'implement' && t.status === 'running')
    // Simulate a crash: a second process opens the same database while the first never finishes.
    engines.splice(engines.indexOf(first.engine), 1)
    const second = await Engine.open({ dataDir, registry: new AdapterRegistry([script()]), skipProbe: true })
    engines.push(second)
    const paused = second.store.getTask(task.id)!
    expect(paused.status).toBe('paused')
    expect(paused.stages.find((s) => s.stage === 'implement')!.status).toBe('interrupted')
    expect(paused.plan).not.toBeNull() // completed stage output survived
    await second.execute({ type: 'task.resume', taskId: task.id })
    const ready = await until(second, task.id, waiting)
    expect(ready.stages.filter((s) => s.stage === 'plan')).toHaveLength(1) // plan was not repeated
  })

  it('applies remote device scopes', async () => {
    const { engine, projectId } = await setup(script())
    const viewOnly = { kind: 'remote' as const, deviceId: 'd1', scopes: ['view' as const] }
    const control = { kind: 'remote' as const, deviceId: 'd2', scopes: ['view' as const, 'control' as const] }
    const createCmd = { type: 'task.create', projectId, prompt: 'x', intent: 'change', mode: 'developer', assignment: ALL }
    expect(await engine.execute(createCmd, viewOnly)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(await engine.execute({ type: 'project.add', root: 'C:/x' }, control)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    const created = await engine.execute(createCmd, control)
    expect(created.ok).toBe(true)
    const id = (created as { result: Task }).result.id
    await until(engine, id, waiting)
    expect(await engine.execute({ type: 'task.decide', taskId: id, decision: 'accept', headSha: 'a'.repeat(40) }, control)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })

  it('rejects invalid commands and analysis-only tasks never create a workspace', async () => {
    const { engine, projectId } = await setup(script({ planner: () => ({ structured: { answer: 'add() subtracts.', keyFindings: ['bug on line 2'], filesReferenced: ['math.js'] } }) }))
    expect(await engine.execute({ type: 'task.create', projectId })).toMatchObject({ ok: false, error: { code: 'invalid' } })
    const task = await create(engine, projectId, { intent: 'analyze' })
    const done = await until(engine, task.id, (t) => t.status === 'completed')
    expect(done.outcome).toBe('answered')
    expect(done.answer).toContain('add() subtracts.')
    expect(done.workspace).toBeNull()
  })

  it('stores no credentials or account identity anywhere in its database', async () => {
    const { engine, projectId } = await setup(script())
    const task = await create(engine, projectId)
    await until(engine, task.id, waiting)
    // The backup is a complete, checkpointed copy (the live file may still have data in its WAL).
    const db = readFileSync(engine.backup()).toString('latin1')
    expect(db).toContain('Fix add() so tests pass') // sanity: the scan really sees task data
    for (const pattern of [/sk-ant-[A-Za-z0-9_-]{10,}/, /sk-[A-Za-z0-9]{20,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /refresh_token/i, /access_token/i, /"email"/i]) {
      expect(db).not.toMatch(pattern)
    }
  })
})
