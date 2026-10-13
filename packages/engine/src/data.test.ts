import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter } from './agents/scripted.js'
import { BUGGY_NODE_PROJECT, cleanup, FIXED_MATH, makeRepo, tempDir } from './testing/fixtures.js'

// Owner requirements: data stays local and private to the user, is exportable,
// and never contains the customer's provider credentials (docs/v2/DECISIONS.md D-011, D-012).

const FAKE_ANTHROPIC = 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE0000'
const FAKE_OPENAI = 'sk-proj-FAKEFAKEFAKEFAKEFAKEFAKEFAKE1111'

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

function adapter() {
  return new ScriptedAdapter((request) => {
    if (request.role === 'planner') return { structured: { summary: 'Fix add()', steps: ['use +'], acceptanceCriteria: ['tests pass'], risks: [], filesLikelyTouched: ['math.js'] } }
    if (request.role === 'implementer') return { files: { 'math.js': FIXED_MATH }, structured: { summary: 'done', followUps: [] } }
    return { structured: { verdict: 'approve', summary: 'ok', findings: [], acceptanceCriteriaMet: [{ criterion: 'tests pass', met: true, note: '' }] } }
  })
}

async function open() {
  const dataDir = tempDir('hydra-data-')
  const repo = makeRepo(BUGGY_NODE_PROJECT)
  dirs.push(dataDir, repo)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([adapter()]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  return { engine, dataDir, projectId: project.result.id }
}

async function finished(engine: Engine, taskId: string): Promise<Task> {
  for (let i = 0; i < 600; i++) {
    const task = engine.store.getTask(taskId)!
    if (task.status === 'waiting_input' || task.status === 'completed' || task.status === 'failed') return task
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('task did not settle')
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)])
}

describe('database ownership', () => {
  it('migrates a new database to the current schema', async () => {
    const { engine } = await open()
    expect(engine.store.schemaVersion).toBeGreaterThanOrEqual(1)
  })

  it.skipIf(process.platform === 'win32')('restricts the data directory, database and backups to the current user', async () => {
    const { engine, dataDir } = await open()
    const backup = engine.backup()
    const exported = engine.exportData()
    expect(statSync(dataDir).mode & 0o777).toBe(0o700)
    expect(statSync(join(dataDir, 'backups')).mode & 0o777).toBe(0o700)
    expect(statSync(join(dataDir, 'hydra.db')).mode & 0o777).toBe(0o600)
    expect(statSync(backup).mode & 0o777).toBe(0o600)
    expect(statSync(exported).mode & 0o777).toBe(0o600)
  })

  it('exports projects and tasks as JSON without keys', async () => {
    const { engine, projectId } = await open()
    engine.store.setKv('remote.identity', 'aa'.repeat(32))
    engine.store.putDevice({ id: 'd1', name: 'Phone', scopes: ['view'], pairedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1e9).toISOString(), revokedAt: null }, { pub: 'bb'.repeat(32) })
    const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'Fix add()', intent: 'change', mode: 'developer', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    await finished(engine, (ack as { result: Task }).result.id)
    const text = readFileSync(engine.exportData(), 'utf8')
    const data = JSON.parse(text) as { format: string; projects: unknown[]; tasks: Array<{ runs: unknown[] }>; devices: unknown[] }
    expect(data.format).toBe('hydra-export')
    expect(data.projects).toHaveLength(1)
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0]!.runs.length).toBeGreaterThan(0)
    expect(data.devices).toHaveLength(1)
    expect(text).not.toContain('aa'.repeat(32))
    expect(text).not.toContain('bb'.repeat(32))
  })

  it('contains no network client code in the engine (no telemetry)', () => {
    const root = join(__dirname)
    const sources = filesUnder(root).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !f.includes('testing'))
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).not.toMatch(/\bfetch\(|from 'node:(http|https|net|dgram|tls)'|XMLHttpRequest|WebSocket\(/)
    }
  })
})

describe('customer credential isolation', () => {
  it('never writes provider credentials from the environment to the database, logs or exports', async () => {
    const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY }
    process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC
    process.env.OPENAI_API_KEY = FAKE_OPENAI
    try {
      const { engine, dataDir, projectId } = await open()
      const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'Fix add()', intent: 'change', mode: 'developer', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
      await finished(engine, (ack as { result: Task }).result.id)
      engine.backup()
      engine.exportData()
      await engine.close()
      engines.splice(engines.indexOf(engine), 1)
      for (const file of filesUnder(dataDir).filter((f) => !f.includes('worktrees') && !f.includes('checkouts'))) {
        const bytes = readFileSync(file).toString('latin1')
        expect(bytes.includes(FAKE_ANTHROPIC), file).toBe(false)
        expect(bytes.includes(FAKE_OPENAI), file).toBe(false)
      }
    } finally {
      if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.a
      if (saved.o === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.o
    }
  })
})
