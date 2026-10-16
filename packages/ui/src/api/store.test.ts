import { describe, expect, it } from 'vitest'
import type { EventEnvelope, Task } from '@hydra/protocol'
import { EngineStore, LIMITS } from './store'
import { FixtureTransport } from '../lab/fixtureTransport'
import { FixtureWorld } from '../lab/world'

async function open() {
  const world = new FixtureWorld()
  const project = world.addProject('shop-api')
  const task = world.createTask(project.id, 'Fix totals')
  const transport = new FixtureTransport(world)
  const store = new EngineStore(transport)
  let renders = 0
  store.subscribe(() => { renders++ })
  await store.start()
  await settle()
  renders = 0
  return { world, task, store, transport, renders: () => renders }
}
const settle = () => new Promise((r) => setTimeout(r, 40))

describe('engine store', () => {
  it('rejects late answer text from a finished attempt, including after a retry starts', async () => {
    const { world, task, store } = await open()
    world.beginStage(task.id, 'implement')
    const first = world.startRun(task.id, 'implement', 'implementer', 'codex')
    world.publish({ type: 'run.output', taskId: task.id, runId: first.id, stream: 'answer', text: 'partial' })
    await settle()
    expect(store.get().drafts[task.id]).toBe('partial')
    world.endRun(first.id)
    world.publish({ type: 'run.output', taskId: task.id, runId: first.id, stream: 'answer', text: 'late' })
    await settle()
    expect(store.get().drafts[task.id]).toBeUndefined()
    const retry = world.startRun(task.id, 'implement', 'implementer', 'codex')
    world.publish({ type: 'run.output', taskId: task.id, runId: retry.id, stream: 'answer', text: 'retry' })
    world.publish({ type: 'run.output', taskId: task.id, runId: first.id, stream: 'answer', text: 'stale first attempt' })
    await settle()
    expect(store.get().drafts[task.id]).toBe('retry')
    world.update(task.id, task => { task.status = 'canceled' })
    world.publish({ type: 'run.output', taskId: task.id, runId: retry.id, stream: 'answer', text: 'after cancel' })
    await settle()
    expect(store.get().drafts[task.id]).toBeUndefined()
  })
  it('applies a burst of events but notifies listeners once', async () => {
    const { world, task, store, renders } = await open()
    world.beginStage(task.id, 'implement')
    const run = world.startRun(task.id, 'implement', 'implementer', 'codex')
    for (let i = 0; i < 500; i++) world.tool(run.id, 'edit', `src/file-${i}.ts`)
    await settle()
    expect(renders()).toBe(1)
    expect(store.get().activity[run.id]).toHaveLength(LIMITS.activityPerRun)
    expect(store.get().activity[run.id]!.at(-1)!.target).toBe('src/file-499.ts')
    expect(store.get().runs[run.id]!.status).toBe('running')
  })

  it('applies a repeated durable event once and ignores an older copy of a task', async () => {
    const { world, task, store } = await open()
    const seen: EventEnvelope[] = []
    world.on((e) => seen.push(e))
    world.update(task.id, (t) => { t.title = 'Newer' })
    await settle()
    const older: Task = { ...store.get().tasks[task.id]!, title: 'Older', updatedAt: new Date(Date.parse(store.get().tasks[task.id]!.updatedAt) - 60_000).toISOString() }
    // A replayed envelope (same seq) and a late, older task state both leave the store unchanged.
    ;(store as unknown as { apply: (e: EventEnvelope) => void }).apply(seen.at(-1)!)
    ;(store as unknown as { apply: (e: EventEnvelope) => void }).apply({ seq: world.seq + 1, at: world.iso(), event: { type: 'task.updated', task: older } })
    await settle()
    expect(store.get().tasks[task.id]!.title).toBe('Newer')
  })

  it('never moves a finished run back to running when a late copy arrives', async () => {
    const { world, task, store } = await open()
    const run = world.startRun(task.id, 'plan', 'planner', 'claude')
    const running = structuredClone(world.runs.get(run.id)!)
    world.endRun(run.id)
    await settle()
    ;(store as unknown as { apply: (e: EventEnvelope) => void }).apply({ seq: world.seq + 5, at: world.iso(), event: { type: 'run.updated', run: running } })
    await settle()
    expect(store.get().runs[run.id]!.status).toBe('succeeded')
  })

  it('drops the live tool-call copy once the run record carries the full list', async () => {
    const { world, task, store } = await open()
    const run = world.startRun(task.id, 'plan', 'planner', 'claude')
    world.tool(run.id, 'Read', 'a.ts')
    await settle()
    expect(store.get().activity[run.id]).toHaveLength(1)
    world.endRun(run.id)
    await settle()
    expect(store.get().activity[run.id]).toBeUndefined()
    expect(store.get().runs[run.id]!.activity).toHaveLength(1)
  })

  it('loads a task\'s runs and checks once, then keeps them current from events', async () => {
    const { world, task, store } = await open()
    world.startRun(task.id, 'plan', 'planner', 'claude')
    world.check(task.id, 'npm test', 'verify', 0, 500)
    await store.loadTask(task.id)
    await store.loadTask(task.id)
    world.check(task.id, 'npm run typecheck', 'verify', 1, 500)
    await settle()
    expect(store.get().loaded[task.id]).toBe(true)
    expect(store.get().evidence[task.id]!.map((e) => e.exitCode)).toEqual([0, 1])
  })

  it('a snapshot taken before newer events never rolls the state back (independent review R2)', async () => {
    const { world, task, store, transport } = await open()
    const older = await transport.snapshot() // taken now, delivered late
    world.now += 5
    world.update(task.id, (t) => { t.status = 'waiting_input'; t.waitReason = 'final_approval' })
    const created = world.createTask(world.projects[0]!.id, 'Created after the snapshot')
    await settle()
    ;(store as unknown as { load: (s: typeof older) => void }).load(older)
    await settle()
    expect(store.get().tasks[task.id]!.status).toBe('waiting_input')
    expect(store.get().tasks[created.id]).toBeDefined()
  })

  it('a deleted task stays deleted, and everything cached for it goes', async () => {
    const { world, task, store, transport } = await open()
    world.startRun(task.id, 'plan', 'planner', 'claude')
    await store.loadTask(task.id)
    const older = await transport.snapshot()
    world.publish({ type: 'task.deleted', taskId: task.id })
    await settle()
    ;(store as unknown as { load: (s: typeof older) => void }).load(older)
    await settle()
    const s = store.get()
    expect(s.tasks[task.id]).toBeUndefined()
    expect(Object.values(s.runs).some((r) => r.taskId === task.id)).toBe(false)
    expect(s.loaded[task.id]).toBeUndefined()
  })

  it('keeps check results only for loaded tasks, and forgets the oldest loaded task beyond the limit (R3, R4)', async () => {
    const { world, store } = await open()
    const ids = Array.from({ length: LIMITS.loadedTasks + 2 }, (_, i) => world.createTask(world.projects[0]!.id, `Task ${i}`).id)
    world.check(ids[0]!, 'npm test', 'verify', 0, 100) // not loaded yet: not kept
    await settle()
    expect(store.get().evidence[ids[0]!]).toBeUndefined()
    for (const id of ids) await store.loadTask(id)
    expect(Object.keys(store.get().loaded)).toHaveLength(LIMITS.loadedTasks)
    expect(store.get().loaded[ids[0]!]).toBeUndefined()
    expect(store.get().evidence[ids[0]!]).toBeUndefined()
    await store.loadTask(ids[0]!) // opening it again fetches its history
    expect(store.get().evidence[ids[0]!]).toHaveLength(1)
  })

  it('bounds streamed output per run and the number of runs it keeps text for', async () => {
    const { world, task, store } = await open()
    const run = world.startRun(task.id, 'plan', 'planner', 'claude')
    for (let i = 0; i < 2000; i++) world.say(run.id, 'x'.repeat(100))
    for (let i = 0; i < LIMITS.outputRuns + 10; i++) world.publish({ type: 'run.output', runId: `other-${i}`, taskId: task.id, text: 'y' })
    await settle()
    expect(Object.keys(store.get().output).length).toBeLessThanOrEqual(LIMITS.outputRuns)
    for (const text of Object.values(store.get().output)) expect(text.length).toBeLessThanOrEqual(LIMITS.outputChars)
  })
})
