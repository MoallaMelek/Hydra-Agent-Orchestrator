import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter } from './agents/scripted.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from './testing/fixtures.js'

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

async function open(dataDir = tempDir('hydra-history-'), delayMs = 0) {
  const repo = makeRepo(BUGGY_NODE_PROJECT)
  dirs.push(dataDir, repo)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([new ScriptedAdapter(() => ({ text: 'an answer', delayMs }))]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  const ask = async (prompt: string, followUpOf?: string) => {
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt, depth: 'standard', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' }, ...(followUpOf ? { followUpOf } : {}) })
    if (!ack.ok) throw new Error(ack.error.message)
    const id = (ack.result as Task).id
    for (let i = 0; i < 400 && ['queued', 'running'].includes(engine.store.getTask(id)!.status); i++) await new Promise((r) => setTimeout(r, 20))
    return engine.store.getTask(id)!
  }
  return { engine, ask, dataDir, projectId: project.result.id }
}

describe('conversation history', () => {
  it('archives and restores a whole conversation', async () => {
    const { engine, ask } = await open()
    const first = await ask('What does add() return?')
    const second = await ask('Why?', first.id)
    const other = await ask('Unrelated question')
    expect((await engine.execute({ type: 'task.archive', taskId: second.id, archived: true })).ok).toBe(true)
    expect(engine.store.getTask(first.id)!.archivedAt).not.toBeNull()
    expect(engine.store.getTask(second.id)!.archivedAt).not.toBeNull()
    expect(engine.store.getTask(other.id)!.archivedAt).toBeNull()
    await engine.execute({ type: 'task.archive', taskId: first.id, archived: false })
    expect(engine.store.getTask(first.id)!.archivedAt).toBeNull()
    expect(engine.store.getTask(second.id)!.archivedAt).toBeNull()
  })

  it('refuses to archive a running task', async () => {
    const { engine, projectId } = await open(undefined, 5_000)
    const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'slow question', depth: 'standard', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    const id = (ack as { result: Task }).result.id
    for (let i = 0; i < 100 && engine.store.getTask(id)!.status !== 'running'; i++) await new Promise((r) => setTimeout(r, 20))
    expect(await engine.execute({ type: 'task.archive', taskId: id, archived: true })).toMatchObject({ ok: false, error: { code: 'conflict' } })
    await engine.execute({ type: 'task.cancel', taskId: id })
  })

  it('opens a database written before routing, follow-ups and archiving existed', async () => {
    const { engine, ask, dataDir } = await open()
    const task = await ask('old question')
    await engine.close()
    engines.splice(engines.indexOf(engine), 1)
    // Simulate an older version's row: the new fields are absent from the stored document.
    const db = new DatabaseSync(join(dataDir, 'hydra.db'))
    const row = db.prepare('SELECT doc FROM tasks WHERE id = ?').get(task.id) as { doc: string }
    const doc = JSON.parse(row.doc) as Record<string, unknown>
    delete doc.route; delete doc.followUpOf; delete doc.archivedAt
    db.prepare('UPDATE tasks SET doc = ? WHERE id = ?').run(JSON.stringify(doc), task.id)
    db.close()
    const reopened = await Engine.open({ dataDir, registry: new AdapterRegistry([new ScriptedAdapter(() => ({ text: 'x' }))]), skipProbe: true })
    engines.push(reopened)
    const old = reopened.store.getTask(task.id)!
    expect(old.answer).toBe('an answer')
    expect(old.route).toBeNull()
    expect(old.followUpOf).toBeNull()
    expect(old.archivedAt).toBeNull()
    expect(reopened.snapshot().tasks.some((t) => t.id === task.id)).toBe(true)
  })
})
