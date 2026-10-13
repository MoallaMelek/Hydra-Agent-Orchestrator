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
