import { afterEach, describe, expect, it } from 'vitest'
import type { Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptHandler } from './agents/scripted.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from './testing/fixtures.js'

// A request is acknowledged only when Hydra has accepted it; every later failure is visible on the task.

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

async function open(handler: ScriptHandler) {
  const dataDir = tempDir('hydra-ack-')
  const repo = makeRepo(BUGGY_NODE_PROJECT)
  dirs.push(dataDir, repo)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([new ScriptedAdapter(handler)]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  return { engine, projectId: project.result.id }
}

async function settle(engine: Engine, id: string): Promise<Task> {
  for (let i = 0; i < 400; i++) {
    const t = engine.store.getTask(id)!
    if (t.status !== 'queued' && t.status !== 'running') return t
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('did not settle')
}

describe('acknowledgments and failure visibility', () => {
  it('refuses a request for a provider that is not available, and stores nothing', async () => {
    const { engine, projectId } = await open(() => ({ text: 'x' }))
    const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'hi', mode: 'safe', assignment: { planner: 'claude', implementer: 'claude', reviewer: 'claude' } })
    expect(ack.ok).toBe(false)
    expect(ack.ok ? null : ack.error.code).toBe('unavailable')
    expect(engine.store.listTasks()).toHaveLength(0)
  })

  it('an agent that cannot start pauses the task with guidance, never silently', async () => {
    const { engine, projectId } = await open(() => ({ fail: 'Could not start claude: spawn ENOENT' }))
    const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'What does add() return?', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    expect(ack.ok).toBe(true)
    const task = await settle(engine, (ack as { result: Task }).result.id)
    // Resumable once the CLI is installed (provider-failures.test.ts covers the categories).
    expect(task.status).toBe('paused')
    expect(task.error).toMatch(/could not be started/)
    expect(engine.store.listRuns(task.id).at(-1)).toMatchObject({ status: 'failed' })
  })

  it('an agent that crashes mid-change fails the task and keeps the workspace for inspection', async () => {
    let call = 0
    const { engine, projectId } = await open((request) => {
      call++
      if (request.role === 'planner') return { structured: { summary: 'p', steps: ['s'], acceptanceCriteria: ['c'], risks: [], filesLikelyTouched: [], reply: '' } }
      return { files: { 'half.js': 'partial' }, fail: 'provider process exited with code 137' }
    })
    const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'Fix add() in math.js', mode: 'developer', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    const task = await settle(engine, (ack as { result: Task }).result.id)
    expect(call).toBe(2)
    expect(task.status).toBe('failed')
    expect(task.error).toMatch(/exited with code 137/)
    expect(task.workspace?.removed).toBe(false)
  })

  it('rejects malformed commands with a typed error instead of accepting them', async () => {
    const { engine } = await open(() => ({ text: 'x' }))
    for (const bad of [{}, { type: 'task.create' }, { type: 'task.create', projectId: 'nope', prompt: '', mode: 'safe', assignment: {} }, { type: 'no.such.command' }]) {
      const ack = await engine.execute(bad)
      expect(ack.ok).toBe(false)
      expect(ack.ok ? null : ack.error.code).toBe('invalid')
    }
  })
})
