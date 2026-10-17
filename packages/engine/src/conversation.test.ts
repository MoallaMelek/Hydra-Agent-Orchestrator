import { afterEach, describe, expect, it } from 'vitest'
import type { Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter } from './agents/scripted.js'
import { answerPrompt, planPrompt } from './prompts/prompts.js'
import { BUGGY_NODE_PROJECT, cleanup, gitIn, makeRepo, tempDir } from './testing/fixtures.js'

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

async function until(engine: Engine, id: string, done: (t: Task) => boolean): Promise<Task> {
  for (let i = 0; i < 400; i++) {
    const t = engine.store.getTask(id)!
    if (done(t)) return t
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('task did not settle')
}

describe('conversational messages', () => {
  it('keeps selected repository scope distinct from trusted runtime facts and persists that provenance', async () => {
    const adapter = new ScriptedAdapter((_request, call) => call === 1 ? { text: 'This answer concerns the selected repository, not the installed application.' } : { fail: 'Deliberate failed retry' })
    const dataDir = tempDir('hydra-context-')
    const repo = makeRepo(BUGGY_NODE_PROJECT)
    dirs.push(dataDir, repo)
    const engine = await Engine.open({ dataDir, version: '2.0.0-test.7', registry: new AdapterRegistry([adapter]), skipProbe: true })
    engines.push(engine)
    const project = await engine.execute({ type: 'project.add', root: repo }) as { ok: true; result: { id: string } }
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt: 'analyze yourself', depth: 'standard', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } }) as { ok: true; result: Task }
    expect(ack.ok).toBe(true)
    const done = await until(engine, ack.result.id, t => t.status === 'completed')
    expect(done.sourceContext).toEqual({ projectRoot: repo, runtimeVersion: '2.0.0-test.7' })
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]!.cwd).toBe(repo)
    expect(adapter.calls[0]!.access).toBe('read')
    expect(adapter.calls[0]!.prompt).toContain(JSON.stringify({ projectRoot: repo }))
    expect(adapter.calls[0]!.prompt).toContain('"2.0.0-test.7"')
    expect(adapter.calls[0]!.prompt).toContain('Do not switch checkouts or claim to have inspected the installed application')
    expect(done.workspace).toBeNull()
    const retainedContext = { projectRoot: repo, runtimeVersion: '0.2.61-test' }
    engine.store.putTask({ ...done, status: 'failed', stage: 'plan', sourceContext: retainedContext })
    const resumed = await engine.execute({ type: 'task.resume', taskId: done.id })
    expect(resumed.ok).toBe(true)
    const failed = await until(engine, done.id, t => t.status === 'failed' || t.status === 'paused')
    expect(adapter.calls).toHaveLength(2)
    expect(failed.answer).toBe(done.answer)
    expect(failed.sourceContext).toEqual(retainedContext)
  })

  it('answers a question sent as a change without a plan, approval or leftover workspace', async () => {
    const adapter = new ScriptedAdapter(() => ({
      structured: { summary: 'A question about the platform', steps: [], acceptanceCriteria: [], risks: [], filesLikelyTouched: [], reply: 'Yes. It plans, edits in isolation, and runs your tests itself.' }
    }))
    const dataDir = tempDir('hydra-conv-')
    const repo = makeRepo(BUGGY_NODE_PROJECT)
    dirs.push(dataDir, repo)
    const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([adapter]), skipProbe: true })
    engines.push(engine)
    const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt: 'are u a good platform', intent: 'change', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    const done = await until(engine, (ack as { result: Task }).result.id, (t) => t.status !== 'queued' && t.status !== 'running')

    expect(done.status).toBe('completed')
    expect(done.outcome).toBe('answered')
    expect(done.answer).toContain('runs your tests itself')
    expect(done.plan).toBeNull()
    expect(done.workspace?.removed).toBe(true)
    expect(gitIn(repo, 'branch', '--list', 'hydra/*')).toBe('')
    expect(adapter.calls).toHaveLength(1)
  })

  it('tells agents to reply naturally instead of narrating the pipeline', () => {
    const task = { prompt: 'hi', feedback: [] } as unknown as Task
    for (const prompt of [answerPrompt(task), planPrompt(task)]) {
      expect(prompt).toContain('Match the user\'s tone and length')
      expect(prompt).toContain('Do not describe how you were run')
      expect(prompt).not.toContain('one stage of a pipeline')
    }
    expect(planPrompt(task)).toContain('put your reply to the user in reply')
  })
})
