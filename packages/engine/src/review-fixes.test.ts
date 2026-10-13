import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventEnvelope, Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptHandler } from './agents/scripted.js'
import { runJsonlProcess } from './agents/jsonl-process.js'
import { waitForExit } from './process/spawn.js'
import { streamableLength } from './orchestrator/agent-runner.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from './testing/fixtures.js'

// Regression tests for the independent review of the adaptive-execution changes (SECURITY_AUDIT A4).

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

const ALL = { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } as const

async function open(handler: ScriptHandler) {
  const dataDir = tempDir('hydra-fix-')
  const repo = makeRepo(BUGGY_NODE_PROJECT)
  dirs.push(dataDir, repo)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([new ScriptedAdapter(handler)]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  const events: EventEnvelope[] = []
  engine.subscribe((e) => events.push(e))
  const create = async (prompt: string, extra: Record<string, unknown> = {}) => {
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt, mode: 'developer', assignment: ALL, ...extra })
    if (!ack.ok) throw new Error(ack.error.message)
    return (ack.result as Task).id
  }
  const settle = async (id: string) => {
    for (let i = 0; i < 600; i++) {
      const t = engine.store.getTask(id)!
      if (t.status !== 'queued' && t.status !== 'running') return t
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('did not settle')
  }
  return { engine, events, create, settle }
}

const KEY_BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'
const PEM = `-----BEGIN PRIVATE KEY-----\n${KEY_BODY}\nZm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3Bx\n-----END PRIVATE KEY-----`

describe('A4-1: streamed answers never show part of a secret', () => {
  it('holds back an unclosed key block and the unfinished last word', () => {
    expect(streamableLength('Here it is: -----BEGIN PRIVATE KEY-----\nMIIE')).toBe('Here it is: '.length)
    expect(streamableLength('Your key sk-an')).toBe('Your key '.length)
    expect(streamableLength(`${PEM}\nDone and `)).toBe(`${PEM}\nDone and `.length)
  })

  it('a private key streamed line by line with real pauses is never published', async () => {
    const reply = `The file contains a key:\n${PEM}\nRemove it from the repository.`
    const { events, create, settle } = await open(() => ({ text: reply, chunkSize: 9, chunkDelayMs: 120 }))
    const done = await settle(await create('what is in key.pem?', { depth: 'standard' }))
    const streamed = events.filter((e) => e.event.type === 'run.output').map((e) => (e.event as { text: string }).text).join('')
    expect(streamed).not.toContain(KEY_BODY.slice(0, 12))
    expect(streamed).toContain('The file contains a key')
    expect(done.answer).not.toContain(KEY_BODY.slice(0, 12))
    expect(done.answer).toContain('[redacted private key]')
  }, 30_000)
})

describe('A4-2: risky plans stop for approval even when the request sounded harmless', () => {
  it('escalates a Developer-mode change whose plan deletes data', async () => {
    const { engine, create, settle } = await open(() => ({
      structured: { summary: 'Tidy the user module', steps: ['Remove all records from the users table', 'Refactor helpers'], acceptanceCriteria: ['tests pass'], risks: [], filesLikelyTouched: ['src/users.ts'], reply: '' }
    }))
    const id = await create('Tidy up the user module', { depth: 'deep' })
    expect(engine.store.getTask(id)!.route?.risk).toBe('normal')
    const t = await settle(id)
    expect(t.route?.risk).toBe('high')
    expect(t.status).toBe('waiting_input')
    expect(t.waitReason).toBe('plan_approval')
  })
})

describe('A4-3: a pre-started process handed to a cancelled run is cleaned up', () => {
  it('kills the prestarted child when the run was already cancelled', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const abort = new AbortController()
    abort.abort()
    const events = []
    for await (const event of runJsonlProcess({ executable: 'x', args: [], cwd: '.', env: process.env, stdin: '', timeoutMs: 1000, translate: () => [], conclude: () => ({ status: 'succeeded', detail: null }), prestarted: child }, abort.signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'finished', status: 'canceled' })
    expect(await waitForExit(child, 5000)).toBe(true)
  })
})

describe('A4-4: a process that will not stop is reported and no longer read', () => {
  it('reports it as possibly still running and ignores its later output', async () => {
    // A stand-in for a process that ignores every stop request.
    const fake = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() }) as unknown as ChildProcess
    let translated = 0
    const events = []
    for await (const event of runJsonlProcess({
      executable: 'x', args: [], cwd: '.', env: process.env, stdin: '', timeoutMs: 50, stopDeadlineMs: 200,
      translate: () => { translated++; return [{ type: 'text', text: 'late' }] }, conclude: () => ({ status: 'succeeded', detail: null }), prestarted: fake
    }, new AbortController().signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'finished', status: 'failed' })
    expect(String((events.at(-1) as { detail: string }).detail)).toMatch(/may still be running/)
    const before = translated
    ;(fake.stdout as PassThrough).write('{"type":"x"}\n{"type":"y"}\n')
    await new Promise((r) => setTimeout(r, 50))
    expect(translated).toBe(before)
  })
})

describe('A4-6: archive and delete keep conversations consistent', () => {
  it('archives a follow-up whose first message was deleted, and re-links follow-ups on delete', async () => {
    const { engine, create, settle } = await open(() => ({ text: 'answer' }))
    const a = (await settle(await create('first question', { depth: 'standard' }))).id
    const b = (await settle(await create('second', { depth: 'standard', followUpOf: a }))).id
    const c = (await settle(await create('third', { depth: 'standard', followUpOf: b }))).id
    expect((await engine.execute({ type: 'task.delete', taskId: b })).ok).toBe(true)
    expect(engine.store.getTask(c)!.followUpOf).toBe(a)
    expect((await engine.execute({ type: 'task.delete', taskId: a })).ok).toBe(true)
    expect(engine.store.getTask(c)!.followUpOf).toBeNull()
    const ack = await engine.execute({ type: 'task.archive', taskId: c, archived: true })
    expect(ack.ok).toBe(true)
    expect(engine.store.getTask(c)!.archivedAt).not.toBeNull()
  })
})
