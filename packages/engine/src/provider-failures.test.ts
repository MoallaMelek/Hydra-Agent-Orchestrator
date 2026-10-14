import { afterEach, describe, expect, it } from 'vitest'
import type { Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptHandler } from './agents/scripted.js'
import { providerFailure } from './util/errors.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from './testing/fixtures.js'

// Provider failures, using the messages the CLIs print. (Sign-in expiry and network loss
// were not provoked against the real services: that would sign the user out.)

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

async function open(handler: ScriptHandler) {
  const adapter = new ScriptedAdapter(handler)
  const dataDir = tempDir('hydra-pf-')
  const repo = makeRepo(BUGGY_NODE_PROJECT)
  dirs.push(dataDir, repo)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([adapter]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  const ask = async () => {
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt: 'What does add() return?', depth: 'standard', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    return (ack as { result: Task }).result.id
  }
  const settle = async (id: string): Promise<Task> => {
    for (let i = 0; i < 600; i++) {
      const t = engine.store.getTask(id)!
      if (t.status !== 'queued' && t.status !== 'running') return t
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('did not settle')
  }
  return { engine, adapter, ask, settle }
}

describe('classifying provider failures', () => {
  it.each([
    ['Invalid API key · Please run /login', 'sign_in'],
    ['OAuth token has expired. Please obtain a new token or refresh your existing token.', 'sign_in'],
    ['Not logged in. Run codex login', 'sign_in'],
    ['You have hit your usage limit. Try again at 5pm', 'limit'],
    ['API Error: 529 Overloaded', 'limit'],
    ['request failed: fetch failed (ECONNRESET)', 'network'],
    ['API Error: 503 Service Unavailable', 'network'],
    ['Could not start claude: spawn claude ENOENT', 'missing'],
    ['TypeError: cannot read properties of undefined', 'other']
  ] as const)('%s → %s', (message, kind) => {
    expect(providerFailure(message)).toBe(kind)
  })
})

describe('recovering from provider failures', () => {
  it('an expired sign-in pauses with what to do, and Resume continues once signed in', async () => {
    let signedIn = false
    const { engine, ask, settle } = await open(() => (signedIn ? { text: 'add() subtracts' } : { fail: 'Invalid API key · Please run /login' }))
    const paused = await settle(await ask())
    expect(paused.status).toBe('paused')
    expect(paused.error).toMatch(/sign in again/)
    expect(paused.answer).toBeNull()
    signedIn = true
    await engine.execute({ type: 'task.resume', taskId: paused.id })
    const done = await settle(paused.id)
    expect(done.status).toBe('completed')
    expect(done.answer).toBe('add() subtracts')
  })

  it('a network blip is retried once and the task completes', async () => {
    const { engine, adapter, ask, settle } = await open((_r, call) => (call === 1 ? { fail: 'fetch failed: ECONNRESET' } : { text: 'ok' }))
    const done = await settle(await ask())
    expect(done.status).toBe('completed')
    expect(adapter.calls).toHaveLength(2)
    expect(engine.store.listRuns(done.id).map((r) => r.status)).toEqual(['failed', 'succeeded'])
  }, 20_000)

  it('a lasting network failure pauses after one retry instead of looping', async () => {
    const { adapter, ask, settle } = await open(() => ({ fail: 'getaddrinfo ENOTFOUND api.anthropic.com' }))
    const paused = await settle(await ask())
    expect(paused.status).toBe('paused')
    expect(paused.error).toMatch(/tried twice/)
    expect(adapter.calls).toHaveLength(2)
  }, 20_000)

  it('a provider that cannot be started pauses with install guidance', async () => {
    const { ask, settle } = await open(() => ({ fail: 'Could not start claude: spawn claude ENOENT' }))
    const paused = await settle(await ask())
    expect(paused.status).toBe('paused')
    expect(paused.error).toMatch(/could not be started.*installed/)
  })

  it('an unexplained crash fails the task with the reason and never reports success', async () => {
    const { ask, settle } = await open(() => ({ fail: 'claude exited with code 3221225477' }))
    const failed = await settle(await ask())
    expect(failed.status).toBe('failed')
    expect(failed.error).toMatch(/3221225477/)
    expect(failed.answer).toBeNull()
  })
})
