import { afterEach, describe, expect, it } from 'vitest'
import type { CheckDraft, Task } from '@hydra/protocol'
import { Engine } from '../engine.js'
import { AdapterRegistry } from '../agents/registry.js'
import { ScriptedAdapter } from '../agents/scripted.js'
import { validateCheck } from './custom.js'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from '../testing/fixtures.js'

const dirs: string[] = []
const engines: Engine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close().catch(() => {})
  cleanup(...dirs.splice(0))
})

const draft = (argv: string[], over: Partial<CheckDraft> = {}): CheckDraft => ({ label: argv.join(' '), kind: 'test', argv, cwd: '.', timeoutSec: 60, required: true, ...over })

async function open() {
  const dataDir = tempDir('hydra-checks-')
  const repo = makeRepo(BUGGY_NODE_PROJECT)
  dirs.push(dataDir, repo)
  const engine = await Engine.open({ dataDir, skipProbe: true, registry: new AdapterRegistry([new ScriptedAdapter((r) => r.role === 'planner' ? { structured: { summary: 'p', steps: ['s'], acceptanceCriteria: ['c'], risks: [], filesLikelyTouched: [], reply: '' } } : { structured: { summary: 'x', followUps: [] } })]) })
  engines.push(engine)
  const project = (await engine.execute({ type: 'project.add', root: repo })) as { ok: true; result: { id: string } }
  return { engine, projectId: project.result.id }
}

describe('validating verification commands', () => {
  it.each([
    [['rm', '-rf', 'dist'], /cannot be a check/],
    [['C:\\Windows\\System32\\curl.exe', 'https://example.com'], /cannot be a check/],
    [['git', 'push'], /changes your repository/],
    [['npm', 'publish'], /publishes/],
    [['sudo', 'make', 'test'], /cannot be a check/]
  ])('refuses %j', (argv, message) => {
    expect(validateCheck(draft(argv)).errors.join(' ')).toMatch(message)
  })

  it('refuses a folder outside the project', () => {
    expect(validateCheck(draft(['npm', 'test'], { cwd: '../other' })).errors).toHaveLength(1)
    expect(validateCheck(draft(['npm', 'test'], { cwd: 'C:/Windows' })).errors).toHaveLength(1)
  })

  it('accepts ordinary commands, and warns about inline code and shell syntax', () => {
    expect(validateCheck(draft(['npm', 'test']))).toEqual({ errors: [], warnings: [] })
    expect(validateCheck(draft(['python', '-m', 'pytest'], { cwd: 'backend' })).errors).toEqual([])
    expect(validateCheck(draft(['bash', '-c', 'npm test && npm run lint'])).warnings.join(' ')).toMatch(/inline code/)
    expect(validateCheck(draft(['npm', 'test', '|', 'tee', 'log'])).warnings.join(' ')).toMatch(/without a shell/)
  })
})

describe('the checks editor', () => {
  it('shows detected checks, saves your own list, and restores detection', async () => {
    const { engine, projectId } = await open()
    const before = (await engine.execute({ type: 'project.checks.get', projectId })) as { ok: true; result: { source: string; checks: Array<{ label: string }> } }
    expect(before.result.source).toBe('detected')
    expect(before.result.checks.map((c) => c.label)).toEqual(['npm run test'])
    const mine = [draft(['node', '--test'], { label: 'Unit tests' }), draft(['npm', 'run', 'lint'], { label: 'Lint', kind: 'lint', required: false })]
    expect((await engine.execute({ type: 'project.checks.set', projectId, checks: mine })).ok).toBe(true)
    const after = (await engine.execute({ type: 'project.checks.get', projectId })) as { ok: true; result: { source: string; checks: Array<{ label: string; required: boolean }> } }
    expect(after.result.source).toBe('yours')
    expect(after.result.checks.map((c) => [c.label, c.required])).toEqual([['Unit tests', true], ['Lint', false]])
    await engine.execute({ type: 'project.checks.set', projectId, checks: null })
    const restored = (await engine.execute({ type: 'project.checks.get', projectId })) as { ok: true; result: { source: string } }
    expect(restored.result.source).toBe('detected')
  })

  it('refuses to save a forbidden command and keeps the previous list', async () => {
    const { engine, projectId } = await open()
    const ack = await engine.execute({ type: 'project.checks.set', projectId, checks: [draft(['rm', '-rf', '.'])] })
    expect(ack).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(engine.store.getProject(projectId)!.checks).toBeNull()
  })

  it('tests a command for real on a copy of the last commit', async () => {
    const { engine, projectId } = await open()
    const failing = (await engine.execute({ type: 'project.checks.test', projectId, check: draft(['node', '--test']) })) as { ok: true; result: { passed: boolean; exitCode: number; outputTail: string } }
    expect(failing.result.passed).toBe(false) // the fixture's add() is buggy
    expect(failing.result.exitCode).not.toBe(0)
    const passing = (await engine.execute({ type: 'project.checks.test', projectId, check: draft(['node', '--version']) })) as { ok: true; result: { passed: boolean } }
    expect(passing.result.passed).toBe(true)
  }, 60_000)

  it('new changes use your list', async () => {
    const { engine, projectId } = await open()
    await engine.execute({ type: 'project.checks.set', projectId, checks: [draft(['node', '--test'], { label: 'My tests' })] })
    const ack = await engine.execute({ type: 'task.create', projectId, prompt: 'Fix add()', depth: 'deep', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } })
    const id = (ack as { result: Task }).result.id
    for (let i = 0; i < 400 && engine.store.getTask(id)!.status !== 'waiting_input'; i++) await new Promise((r) => setTimeout(r, 25))
    expect(engine.store.getTask(id)!.checks.map((c) => c.label)).toEqual(['My tests'])
  })

  it('a phone cannot change verification commands', async () => {
    const { engine, projectId } = await open()
    const actor = { kind: 'remote' as const, deviceId: 'd', scopes: ['view', 'control', 'approve'] as const }
    expect(await engine.execute({ type: 'project.checks.set', projectId, checks: null }, actor)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(await engine.execute({ type: 'project.checks.test', projectId, check: draft(['node', '--version']) }, actor)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })
})
