/** Explicit disposable acceptance data. Scripted agents, real Git/checks; no provider calls. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Engine } from '../packages/engine/src/engine.js'
import { AdapterRegistry } from '../packages/engine/src/agents/registry.js'
import { ScriptedAdapter } from '../packages/engine/src/agents/scripted.js'
import { BUGGY_NODE_PROJECT, FIXED_MATH, makeRepo } from '../packages/engine/src/testing/fixtures.js'
import type { Task } from '@hydra/protocol'

const dataDir = mkdtempSync(join(tmpdir(), 'hydra-product-evidence-'))
const fixtures: Array<{ name: string; taskId: string; root: string }> = []
let fix = true
let rejectReview = false
const engine = await Engine.open({ dataDir, skipProbe: true, registry: new AdapterRegistry([new ScriptedAdapter(request => {
  if (request.role === 'planner') return { structured: { summary: 'Correct addition while keeping the public function unchanged.', steps: ['Use addition in math.js'], acceptanceCriteria: ['The addition test passes'], risks: ['Callers may have depended on the incorrect result'], filesLikelyTouched: ['math.js'] } }
  if (request.role === 'implementer') return { files: { 'math.js': fix ? FIXED_MATH : '// Deliberately failing acceptance fixture\n' + BUGGY_NODE_PROJECT['math.js'] }, structured: { summary: 'Fixture implementation', followUps: [] } }
  return { structured: { verdict: rejectReview ? 'changes_requested' : 'approve', summary: 'Scripted review fixture.', findings: rejectReview ? [{ severity: 'major', file: 'math.js', issue: 'Deliberate blocking review fixture', suggestion: 'Request a repair' }] : [], acceptanceCriteriaMet: [{ criterion: 'The addition test passes', met: true, note: 'Scripted review, not a model judgment.' }] } }
})]) })
async function create(name: string, root: string, mode: 'safe' | 'developer' = 'safe') {
  const projectAck = await engine.execute({ type: 'project.add', root, name })
  if (!projectAck.ok) throw new Error(projectAck.error.message)
  const projectId = (projectAck.result as { id: string }).id
  const ack = await engine.execute({ type: 'task.create', projectId, title: `Test fixture · ${name}`, prompt: `TEST FIXTURE · ${name}. Fix add() in math.js. This is disposable acceptance data using a scripted agent; no real model activity.`, depth: 'deep', mode, assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' }, budget: { maxFixRounds: 0 } })
  if (!ack.ok) throw new Error(ack.error.message)
  const taskId = (ack.result as Task).id
  for (let i = 0; i < 1200; i++) {
    const task = engine.store.getTask(taskId)!
    if (task.status === 'waiting_input' && task.waitReason === 'plan_approval' && name !== 'Plan approval') {
      const approved = await engine.execute({ type: 'task.approve_plan', taskId, approve: true })
      if (!approved.ok) throw new Error(approved.error.message)
      await new Promise(resolve => setTimeout(resolve, 100)); continue
    }
    if (task.status === 'waiting_input') { fixtures.push({ name, taskId, root }); return }
    if (task.status === 'failed') throw new Error(task.error ?? 'Fixture failed')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Fixture did not settle')
}
try {
  await create('Passing check', makeRepo(BUGGY_NODE_PROJECT))
  fix = false
  await create('Failing check', makeRepo(BUGGY_NODE_PROJECT))
  fix = true
  await create('No checks', makeRepo({ 'math.js': BUGGY_NODE_PROJECT['math.js'] }))
  rejectReview = true
  await create('Reviewer objections', makeRepo(BUGGY_NODE_PROJECT))
  rejectReview = false
  for (const name of ['Stale evidence', 'Missing result', 'Untrusted evidence', 'Changed command', 'Changed definitions', 'Stale review']) {
    await create(name, makeRepo(BUGGY_NODE_PROJECT))
    const id = fixtures.at(-1)!.taskId
    const result = engine.store.listEvidence(id).find(e => e.phase === 'verify')!
    // Explicit fault injection into disposable fixtures, never production records.
    const altered = { ...result, ...(name === 'Stale evidence' ? { commitSha: engine.store.getTask(id)!.workspace!.baseSha } : name === 'Missing result' ? { phase: 'pre_review' as const } : name === 'Changed command' ? {checkSpec:'different command'} : name === 'Changed definitions' ? {definitionsChanged:true} : name === 'Untrusted evidence' ? { treeMutated: true } : {}) }
    const db = new DatabaseSync(join(dataDir, 'hydra.db'))
    try {
      db.prepare('UPDATE evidence SET doc=? WHERE id=?').run(JSON.stringify(altered), result.id)
      if (name === 'Stale review') { const task=engine.store.getTask(id)!; db.prepare('UPDATE tasks SET doc=? WHERE id=?').run(JSON.stringify({...task,reviewedSha:task.workspace!.baseSha}),id) }
    } finally { db.close() }
  }
  await create('Plan approval', makeRepo(BUGGY_NODE_PROJECT), 'safe')
  const report = { dataDir, fixtures, agentSource: 'Scripted test adapter; real engine, Git and check processes; no provider activity' }
  writeFileSync(process.argv[2] ?? join(dataDir, 'fixtures.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await engine.close() }
