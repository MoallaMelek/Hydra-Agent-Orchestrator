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
