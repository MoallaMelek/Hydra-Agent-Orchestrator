import { afterEach, describe, expect, it } from 'vitest'
import type { EventEnvelope, Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptHandler } from './agents/scripted.js'
import { toolKind } from './orchestrator/agent-runner.js'
import { claudeTranslator } from './agents/claude.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from './testing/fixtures.js'

// Instrumentation behind the live operations view: tool activity, agent selection and
// global agent slots. Real engine and real git; the scripted adapter stands in for a CLI.

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

const ALL = { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } as const

async function open(handler: ScriptHandler) {
  const dataDir = tempDir('hydra-ops-')
  const root = makeRepo(BUGGY_NODE_PROJECT)
  dirs.push(dataDir, root)
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([new ScriptedAdapter(handler)]), skipProbe: true })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root })) as { ok: true; result: { id: string } }
  const events: EventEnvelope[] = []
  engine.subscribe((e) => events.push(e))
  const create = async (prompt: string) => {
    const ack = await engine.execute({ type: 'task.create', projectId: project.result.id, prompt, depth: 'standard', mode: 'developer', assignment: ALL })
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
  return { engine, events, create, settle }
}

describe('operations instrumentation', () => {
  it('reports each tool call as structured, redacted activity, live and on the run record', async () => {
    const { engine, events, create, settle } = await open(() => ({
      text: 'It is in src/cart.js.',
      tools: [
        { name: 'Read', summary: 'src/cart.js' },
        { name: 'Grep', summary: 'total\\(' },
        { name: 'Bash', summary: 'curl -H "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" https://x' }
      ]
    }))
    const task = await settle((await create('Where is the cart total computed?')).id)
    expect(task.status).toBe('completed')
    const live = events.flatMap((e) => (e.event.type === 'run.activity' ? [e.event.activity] : []))
    expect(live.map((a) => [a.tool, a.kind])).toEqual([['Read', 'read'], ['Grep', 'search'], ['Bash', 'command']])
    expect(live[0]!.target).toBe('src/cart.js')
    expect(live[2]!.target).not.toContain('abcdefghijklmnopqrstuvwxyz')
    const [run] = engine.taskDetail(task.id).runs
    expect(run!.activity.map((a) => a.tool)).toEqual(['Read', 'Grep', 'Bash'])
    expect(JSON.stringify(run!.activity)).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })

  it('records whether the agents were Hydra\'s suggestion, with the stated reason', async () => {
    const { create } = await open(() => ({ text: 'ok' }))
    const task = await create('What does total() return?')
    expect(task.selection).toMatchObject({ basis: 'suggested', suggested: null })
    expect(task.selection!.reason.length).toBeGreaterThan(0)
  })

  it('exposes running agent processes and the slot limit in the snapshot', async () => {
    const { engine, create, settle } = await open(() => ({ text: 'slow answer', delayMs: 400 }))
    expect(engine.snapshot()).toMatchObject({ agentSlots: 3, activeRuns: [] })
    const task = await create('Explain the cart module')
    let seen = false
    for (let i = 0; i < 80 && !seen; i++) {
      seen = engine.snapshot().activeRuns.some((r) => r.taskId === task.id && r.status === 'running')
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(seen).toBe(true)
    await settle(task.id)
    expect(engine.snapshot().activeRuns).toEqual([])
  })

  it('reads the target of each Claude Code tool call, including shell commands', () => {
    const { translate } = claudeTranslator()
    const call = (name: string, input: Record<string, unknown>) => translate({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
    expect(call('Read', { file_path: 'src/a.ts' })).toEqual([{ type: 'tool', name: 'Read', summary: 'src/a.ts' }])
    expect(call('Bash', { command: 'npm test' })).toEqual([{ type: 'tool', name: 'Bash', summary: 'npm test' }])
    expect(call('Grep', { pattern: 'total' })).toEqual([{ type: 'tool', name: 'Grep', summary: 'total' }])
  })

  it('classifies provider tools by how they touch the project', () => {
    expect(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'MultiEdit', 'edit', 'Bash', 'shell', 'WebFetch'].map(toolKind))
      .toEqual(['read', 'search', 'search', 'edit', 'edit', 'edit', 'edit', 'command', 'command', 'other'])
  })
})
