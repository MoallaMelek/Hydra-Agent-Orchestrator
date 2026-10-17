import { expect, it } from 'vitest'
import { verificationReceipt } from '@hydra/protocol'
import { FixtureWorld } from '../../lab/world'
import { approvalWarnings } from './warnings'

it('distinguishes missing, stale, failed and passing final evidence', () => {
  const world = new FixtureWorld()
  let task = world.createTask(world.addProject('receipt').id, 'fixture change')
  world.beginStage(task.id, 'implement')
  task = world.tasks.get(task.id)!
  expect(verificationReceipt(task, []).state).toBe('unverified')
  expect(approvalWarnings(task, [], null).some(w => w.text.includes('no final result'))).toBe(true)
  world.beginStage(task.id, 'verify')
  world.check(task.id, 'npm test', 'verify', 0, 10)
  const record = world.evidence[0]!
  const one = { ...task, checks: [task.checks[0]!] }
  const current = { ...record, commitSha: task.workspace!.headSha!, checkId: task.checks[0]!.id }
  expect(verificationReceipt(one, [current]).state).toBe('passed')
  expect(verificationReceipt(one, [{ ...current, commitSha: 'f'.repeat(40) }]).state).toBe('unverified')
  for (const patch of [{ exitCode: 1 }, { timedOut: true }, { spawnError: 'missing program' }, { treeMutated: true }]) expect(verificationReceipt(one, [{ ...current, ...patch }]).state).toBe('failed')
  expect(verificationReceipt({ ...one, checks: [] }, [current]).state).toBe('unverified')
})
