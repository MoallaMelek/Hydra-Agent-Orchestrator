import type { ProviderId, Task } from '@hydra/protocol'
import type { FixtureTransport } from './fixtureTransport'
import type { FixtureWorld } from './world'

/**
 * SIMULATED FIXTURE SCENARIOS. Each mirrors the order in which the real engine moves a
 * task through its stages (workflow/machine.ts), with invented content. Used to develop
 * and benchmark the interface; never presented as real agent work.
 */

export interface Player {
  world: FixtureWorld
  /** Waits `simMs` of simulated time (scaled by the speed factor). */
  sleep: (simMs: number) => Promise<void>
  transport: FixtureTransport
}

export type ScenarioId = 'simple' | 'complex' | 'concurrent' | 'failed-review' | 'approval' | 'flood' | 'idle' | 'idle-running'

export const SCENARIOS: Record<ScenarioId, { title: string; run: (p: Player) => Promise<string> }> = {
  simple: { title: 'Simple question, one agent', run: simple },
  complex: { title: 'Full change: plan → implement → review → verify → approval', run: complex },
  concurrent: { title: 'Concurrent tasks sharing three agent slots', run: concurrent },
  'failed-review': { title: 'Review requests changes, repair, verification fails once, repaired', run: failedReview },
  approval: { title: 'Risky request stops for plan approval', run: approval },
  flood: { title: 'High-volume events (benchmark)', run: flood },
  idle: { title: 'Idle: finished tasks only (benchmark)', run: idle },
  'idle-running': { title: 'Agents running but silent (benchmark)', run: idleRunning }
}

/** Finished work only: nothing should move or repaint. */
async function idle(p: Player): Promise<string> {
  const project = p.world.addProject('shop-api')
  const t = p.world.createTask(project.id, 'Cart totals ignore quantity. Fix total() and add a test.')
  p.world.update(t.id, (x) => { x.status = 'completed'; x.outcome = 'applied'; x.stage = 'apply' })
  return t.id
}

/** Three agents running with no new events: measures the cost of "something is running" indicators. */
async function idleRunning(p: Player): Promise<string> {
  const project = p.world.addProject('shop-api')
  const ids = [0, 1, 2].map((n) => p.world.createTask(project.id, `Task ${n + 1} with a running agent`).id)
  for (const id of ids) { p.world.beginStage(id, 'implement'); p.world.startRun(id, 'implement', 'implementer', 'codex') }
  return ids[0]!
}

const PLAN = {
  summary: 'Multiply each line price by its quantity in total(), and cover it with a test.',
  steps: ['Read src/cart.js and its tests', 'Change total() to use price × qty', 'Add a test with two quantities', 'Run the test suite'],
  acceptanceCriteria: ['total() includes quantities', 'New test passes', 'Existing tests still pass'],
  risks: [], filesLikelyTouched: ['src/cart.js', 'test/cart.test.js']
}

async function agent(p: Player, taskId: string, stage: Task['stage'], role: 'planner' | 'implementer' | 'reviewer', provider: ProviderId, tools: Array<[string, string]>, ms: number, tokens = 14_000) {
  const release = await p.world.acquireSlot()
  const run = p.world.startRun(taskId, stage, role, provider)
  const step = ms / (tools.length + 1)
  for (const [tool, target] of tools) {
    await p.sleep(step)
    p.world.tool(run.id, tool, target)
  }
  await p.sleep(step)
  p.world.endRun(run.id, 'succeeded', tokens, provider === 'claude' ? tokens / 400_000 : 0)
  release()
  return run
}

async function checks(p: Player, taskId: string, phase: 'pre_review' | 'verify' | 'demo_base' | 'demo_final', pass = true) {
  await p.sleep(900)
  p.world.check(taskId, 'npm run typecheck', phase, 0, 900)
  await p.sleep(1600)
  p.world.check(taskId, 'npm test', phase, pass ? 0 : 1, 1600, pass ? '' : 'FAIL test/cart.test.js › total with quantities\n  expected 30, received 25 (simulated)')
}

async function planStage(p: Player, taskId: string) {
  p.world.beginStage(taskId, 'plan')
  await agent(p, taskId, 'plan', 'planner', 'claude', [['Glob', 'src/**/*.js'], ['Read', 'src/cart.js'], ['Read', 'test/cart.test.js'], ['Grep', 'total\\(']], 5200)
  p.world.setPlan(taskId, PLAN)
  p.world.endStage(taskId)
}

async function implementStage(p: Player, taskId: string, stage: 'implement' | 'fix', n: number) {
  p.world.beginStage(taskId, stage)
  await agent(p, taskId, stage, 'implementer', 'codex', [['shell', 'cat src/cart.js → exit 0'], ['edit', 'src/cart.js'], ['edit', 'test/cart.test.js'], ['shell', 'npm test → exit 0']], 7000, 26_000)
  p.world.commit(taskId, n)
  p.world.endStage(taskId)
}

async function reviewStage(p: Player, taskId: string, approve: boolean) {
  p.world.beginStage(taskId, 'review')
  await checks(p, taskId, 'pre_review')
  await agent(p, taskId, 'review', 'reviewer', 'claude', [['Read', 'src/cart.js'], ['Read', 'test/cart.test.js']], 4200)
  p.world.setReview(taskId, approve
    ? { verdict: 'approve', summary: 'The change is minimal and the new test covers quantities.', findings: [], acceptanceCriteriaMet: PLAN.acceptanceCriteria.map((criterion) => ({ criterion, met: true, note: '' })) }
    : { verdict: 'changes_requested', summary: 'Quantities of zero are not handled and the test misses that case.', findings: [
        { severity: 'major', file: 'src/cart.js', issue: 'qty may be undefined for legacy items; total becomes NaN.', suggestion: 'Default qty to 1.' },
        { severity: 'minor', file: 'test/cart.test.js', issue: 'No test for missing qty.', suggestion: 'Add one.' }
      ], acceptanceCriteriaMet: [] })
  p.world.endStage(taskId, 'succeeded', approve ? 'Approved' : 'Changes requested')
}

async function finish(p: Player, taskId: string) {
  p.world.beginStage(taskId, 'demo')
  await checks(p, taskId, 'demo_base', false)
  await checks(p, taskId, 'demo_final')
  p.world.update(taskId, (t) => {
    t.demo = { baseSha: t.workspace!.baseSha, finalSha: t.workspace!.headSha!, deltas: [
      { checkId: 'node:typecheck', label: 'npm run typecheck', before: 'pass', after: 'pass' },
      { checkId: 'node:test', label: 'npm test', before: 'fail', after: 'pass' }
    ], narrative: 'Simulated fixture: the test that failed on the original commit passes on the result.' }
  })
  p.world.endStage(taskId)
  p.world.update(taskId, (t) => { t.status = 'waiting_input'; t.waitReason = 'final_approval'; t.stage = 'approval' })
  p.world.log(taskId, 'info', 'Waiting for your decision.')
}

async function simple(p: Player): Promise<string> {
  const project = p.world.addProject('shop-api')
  const task = p.world.createTask(project.id, 'Where is the cart total computed?', {
    intent: 'analyze', mode: 'safe', route: { depth: 'standard', auto: true, risk: 'normal', reason: 'A question about this repository.' },
    selection: { basis: 'suggested', reason: 'Rule: Claude Code answers questions (no history yet).', suggested: null }, checks: []
  })
  void (async () => {
    await p.sleep(300)
    p.world.beginStage(task.id, 'plan')
    const run = p.world.startRun(task.id, 'plan', 'planner', 'claude')
    for (const [tool, target] of [['Grep', 'total'], ['Read', 'src/cart.js']]) { await p.sleep(900); p.world.tool(run.id, tool!, target!) }
    const answer = 'The total is computed in `total()` in **src/cart.js**. It sums `price` over the items and ignores `qty`, so quantities above one are undercounted.'
    for (let i = 0; i < answer.length; i += 14) { await p.sleep(70); p.world.publish({ type: 'run.output', runId: run.id, taskId: task.id, text: answer.slice(i, i + 14), stream: 'answer' }) }
    p.world.endRun(run.id, 'succeeded', 6000, 0.012)
    p.world.endStage(task.id)
    p.world.update(task.id, (t) => { t.answer = answer; t.status = 'completed'; t.outcome = 'answered' })
  })()
  return task.id
}

async function complex(p: Player): Promise<string> {
  const project = p.world.addProject('shop-api')
  const task = p.world.createTask(project.id, 'Cart totals ignore quantity. Fix total() and add a test.', {
    selection: { basis: 'suggested', reason: 'Rule: Claude Code plans and reviews, Codex implements, so the review is independent.', suggested: null }
  })
  void (async () => {
    await p.sleep(400)
    await planStage(p, task.id)
    await implementStage(p, task.id, 'implement', 2)
    await reviewStage(p, task.id, true)
    p.world.beginStage(task.id, 'verify')
    await checks(p, task.id, 'verify')
    p.world.endStage(task.id)
    await finish(p, task.id)
  })()
  return task.id
}

async function failedReview(p: Player): Promise<string> {
  const project = p.world.addProject('shop-api')
  const task = p.world.createTask(project.id, 'Cart totals ignore quantity. Fix total() and add a test.', {
    selection: { basis: 'yours', reason: 'Rule: Claude Code plans and reviews, Codex implements.', suggested: { planner: 'claude', implementer: 'codex', reviewer: 'claude' } }
  })
  void (async () => {
    await p.sleep(400)
    await planStage(p, task.id)
    await implementStage(p, task.id, 'implement', 2)
    await reviewStage(p, task.id, false)
    p.world.log(task.id, 'warn', 'Review requested changes: 2 findings. Starting repair round 1.')
    await implementStage(p, task.id, 'fix', 3)
    await reviewStage(p, task.id, true)
    p.world.beginStage(task.id, 'verify')
    await checks(p, task.id, 'verify', false)
    p.world.endStage(task.id, 'succeeded', '1 required check failed')
    p.world.log(task.id, 'warn', 'npm test failed on the result. Starting repair round 2.')
    await implementStage(p, task.id, 'fix', 4)
    await reviewStage(p, task.id, true)
    p.world.beginStage(task.id, 'verify')
    await checks(p, task.id, 'verify')
    p.world.endStage(task.id)
    await finish(p, task.id)
  })()
  return task.id
}

async function approval(p: Player): Promise<string> {
  const project = p.world.addProject('billing')
  const task = p.world.createTask(project.id, 'Delete the legacy invoices table and its migration.', {
    mode: 'safe', route: { depth: 'deep', auto: true, risk: 'high', reason: 'Deleting data needs your approval of the plan.' },
    selection: { basis: 'suggested', reason: 'Rule: Claude Code plans and reviews, Codex implements.', suggested: null }
  })
  p.transport.onCommand = (command) => {
    if (command.type !== 'task.approve_plan' || command.taskId !== task.id) return
    if (!command.approve) { p.world.update(task.id, (t) => { t.status = 'completed'; t.outcome = 'discarded'; t.waitReason = null }); return }
    p.world.update(task.id, (t) => { t.checksApproved = true; t.status = 'queued'; t.waitReason = null })
    void (async () => {
      await implementStage(p, task.id, 'implement', 2)
      await reviewStage(p, task.id, true)
      p.world.beginStage(task.id, 'verify')
      await checks(p, task.id, 'verify')
      p.world.endStage(task.id)
      await finish(p, task.id)
    })()
  }
  void (async () => {
    await p.sleep(400)
    p.world.beginStage(task.id, 'plan')
    await agent(p, task.id, 'plan', 'planner', 'claude', [['Grep', 'invoices'], ['Read', 'db/migrations/0007_invoices.sql'], ['Read', 'src/billing/invoices.ts']], 5000)
    p.world.setPlan(task.id, { summary: 'Drop the legacy invoices table with a new down-migration and remove its model.', steps: ['Add migration 0012 that drops legacy_invoices', 'Remove src/billing/legacyInvoices.ts', 'Update tests'], acceptanceCriteria: ['Migration applies cleanly', 'Tests pass'], risks: ['Drops a table: data in legacy_invoices is lost'], filesLikelyTouched: ['db/migrations/0012_drop_legacy.sql', 'src/billing/legacyInvoices.ts'] })
    p.world.endStage(task.id)
    p.world.update(task.id, (t) => { t.status = 'waiting_input'; t.waitReason = 'plan_approval' })
    p.world.log(task.id, 'warn', 'High-risk request: waiting for you to approve the plan and the check commands.')
  })()
  return task.id
}

async function concurrent(p: Player): Promise<string> {
  const a = p.world.addProject('shop-api')
  const b = p.world.addProject('docs-site')
  const t1 = p.world.createTask(a.id, 'Cart totals ignore quantity. Fix total() and add a test.')
  const t2 = p.world.createTask(b.id, 'Add a dark-mode toggle to the docs header.', { assignment: { planner: 'codex', implementer: 'claude', reviewer: 'codex' } })
  const t3 = p.world.createTask(a.id, 'Rename getUser to fetchUser across the API.')
  const t4 = p.world.createTask(b.id, 'Fix broken links in the getting-started guide.')
  const flow = async (id: string, delay: number) => {
    await p.sleep(delay)
    await planStage(p, id)
    await implementStage(p, id, 'implement', 2)
    await reviewStage(p, id, true)
    p.world.beginStage(id, 'verify')
    await checks(p, id, 'verify')
    p.world.endStage(id)
    await finish(p, id)
  }
  void flow(t1.id, 300); void flow(t2.id, 900); void flow(t3.id, 1500)
  // The fourth task's stage starts while three agents already run: it waits for a slot.
  void (async () => {
    await p.sleep(2100)
    p.world.beginStage(t4.id, 'plan')
    await agent(p, t4.id, 'plan', 'planner', 'claude', [['Read', 'docs/getting-started.md']], 3000)
    p.world.setPlan(t4.id, { ...PLAN, summary: 'Fix the three broken relative links.' })
    p.world.endStage(t4.id)
    await implementStage(p, t4.id, 'implement', 2)
  })()
  return t1.id
}

async function flood(p: Player): Promise<string> {
  const project = p.world.addProject('monorepo')
  const ids: string[] = []
  for (let n = 0; n < 3; n++) ids.push(p.world.createTask(project.id, `Refactor package ${n + 1} to the new logger`).id)
  const params = new URLSearchParams(location.search)
  const perRun = Number(params.get('events') ?? 600)
  // Starts after the view has rendered; the benchmark awaits window.__floodDone.
  const done = (async () => { await p.sleep(1500); await Promise.all(ids.map(async (id, n) => {
    p.world.beginStage(id, 'implement')
    const run = p.world.startRun(id, 'implement', 'implementer', n === 1 ? 'claude' : 'codex')
    for (let i = 0; i < perRun; i++) {
      p.world.tool(run.id, i % 3 === 0 ? 'edit' : i % 3 === 1 ? 'Read' : 'shell', `packages/pkg-${n}/src/file-${i % 97}.ts`)
      if (i % 4 === 0) p.world.say(run.id, `Updated logger call ${i} in file-${i % 97}.ts`)
      if (i % 10 === 0) await p.sleep(16)
    }
    p.world.endRun(run.id)
    p.world.endStage(id)
  })) })()
  ;(window as unknown as { __floodDone: Promise<void> }).__floodDone = done
  return ids[0]!
}
