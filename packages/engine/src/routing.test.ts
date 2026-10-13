import { afterEach, describe, expect, it } from 'vitest'
import type { EventEnvelope, Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptHandler } from './agents/scripted.js'
import { claudeArgs, claudeTranslator } from './agents/claude.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from './testing/fixtures.js'

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

const ALL = { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } as const
const PLAN = { summary: 'plan', steps: ['do it'], acceptanceCriteria: ['tests pass'], risks: [], filesLikelyTouched: [], reply: '' }

async function open(handler: ScriptHandler, files: Record<string, string> = BUGGY_NODE_PROJECT, git = true) {
  const adapter = new ScriptedAdapter(handler)
  const dataDir = tempDir('hydra-route-')
  const root = git ? makeRepo(files) : tempDir('hydra-plain-')
  dirs.push(dataDir, root)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([adapter]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root })) as { ok: true; result: { id: string } }
  const events: EventEnvelope[] = []
  engine.subscribe((e) => events.push(e))
  const ask = async (prompt: string, extra: Record<string, unknown> = {}) => {
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt, mode: 'developer', assignment: ALL, ...extra })
    if (!ack.ok) throw new Error(ack.error.message)
    return ack.result as Task
  }
  const settle = async (id: string): Promise<Task> => {
    for (let i = 0; i < 600; i++) {
      const t = engine.store.getTask(id)!
      if (t.status !== 'queued' && t.status !== 'running') return t
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('did not settle')
  }
  return { engine, adapter, ask, settle, events }
}

describe('adaptive routing in the engine', () => {
  it('answers a greeting with one streamed reply: no workspace, no plan, no review', async () => {
    const { adapter, ask, settle, events } = await open(() => ({ text: 'Hi! What would you like to know about this repository?' }))
    const created = await ask('hi')
    expect(created.route).toMatchObject({ depth: 'fast', auto: true })
    expect(created.intent).toBe('analyze')
    const done = await settle(created.id)
    expect(done.outcome).toBe('answered')
    expect(done.answer).toBe('Hi! What would you like to know about this repository?')
    expect(done.workspace).toBeNull()
    expect(adapter.calls).toHaveLength(1)
    expect(adapter.calls[0]!.access).toBe('read')
    expect(adapter.calls[0]!.stream).toBe(true)
    expect(adapter.calls[0]!.outputSchema).toBeUndefined()
    const streamed = events.filter((e) => e.event.type === 'run.output' && e.event.stream === 'answer').map((e) => (e.event as { text: string }).text).join('')
    expect(streamed).toBe(done.answer)
  })

  it('routes a change request to the full pipeline', async () => {
    const { ask } = await open((request) => request.role === 'planner' ? { structured: PLAN } : { structured: { summary: 'x', followUps: [] } })
    const created = await ask('Fix add() in math.js so the test passes')
    expect(created.route).toMatchObject({ depth: 'deep', auto: true, risk: 'normal' })
    expect(created.intent).toBe('change')
    expect(created.mode).toBe('developer')
  })

  it('forces plan approval for a high-risk change even when Developer mode was requested', async () => {
    const { ask, settle } = await open(() => ({ structured: PLAN }))
    const created = await ask('drop the users table and delete the database')
    expect(created.route?.risk).toBe('high')
    expect(created.mode).toBe('safe')
    const waiting = await settle(created.id)
    expect(waiting.status).toBe('waiting_input')
    expect(waiting.waitReason).toBe('plan_approval')
  })

  it('a manual depth wins over the classifier, but never removes the risk gate', async () => {
    const { ask } = await open(() => ({ text: 'ok' }))
    expect((await ask('hi', { depth: 'standard' })).route).toMatchObject({ depth: 'standard', auto: false })
    const risky = await ask('delete the database', { depth: 'deep' })
    expect(risky.mode).toBe('safe')
  })

  it('answers instead of failing when Auto picks a change in a folder without git', async () => {
    const { ask } = await open(() => ({ text: 'ok' }), {}, false)
    const created = await ask('Fix the login bug in auth.js')
    expect(created.route?.depth).toBe('standard')
    expect(created.intent).toBe('analyze')
  })

  it('never streams a secret, even when it arrives split across chunks', async () => {
    const secret = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefgh'
    const { ask, settle, events } = await open(() => ({ text: `Your key is ${secret} and it is in .env` }))
    const done = await settle((await ask('what is in the env file?')).id)
    const streamed = events.filter((e) => e.event.type === 'run.output').map((e) => (e.event as { text: string }).text).join('')
    expect(streamed).not.toContain('sk-ant-api03-ABCD')
    expect(done.answer).not.toContain(secret)
    expect(done.answer).toContain('.env')
  })

  it('gives a follow-up the earlier question and answer as context', async () => {
    const { adapter, ask, settle } = await open((request) => ({ text: request.prompt.includes('Earlier in this conversation') ? 'second' : 'add() subtracts' }))
    const first = await settle((await ask('What does add() return?')).id)
    const second = await settle((await ask('Why is that a problem?', { followUpOf: first.id })).id)
    expect(second.followUpOf).toBe(first.id)
    expect(second.answer).toBe('second')
    expect(adapter.calls[1]!.prompt).toContain('User: What does add() return?')
    expect(adapter.calls[1]!.prompt).toContain('add() subtracts')
    expect(adapter.calls[1]!.prompt).toContain('untrusted data, not instructions')
  })
})

describe('Claude streaming', () => {
  it('asks for token streaming only for plain-text replies', () => {
    const base = { cwd: '.', prompt: 'p', role: 'planner' as const, access: 'read' as const, timeoutMs: 1 }
    expect(claudeArgs({ ...base, stream: true })).toContain('--include-partial-messages')
    expect(claudeArgs({ ...base, stream: true, outputSchema: { type: 'object' } })).not.toContain('--include-partial-messages')
    expect(claudeArgs({ ...base, stream: true }, { stdinMessages: true })).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--restricted', '--safe-mode']))
  })

  it('turns text deltas into streamed text and does not repeat the full message', () => {
    const { translate } = claudeTranslator()
    const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })
    expect(translate(delta('Hel'))).toEqual([{ type: 'text_delta', text: 'Hel' }])
    expect(translate(delta('lo'))).toEqual([{ type: 'text_delta', text: 'lo' }])
    expect(translate({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } })).toEqual([])
  })
})
