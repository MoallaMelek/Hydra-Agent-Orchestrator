

import { expect, it } from 'vitest'
import type { Task } from '@hydra/protocol'
import { outcomeFor } from './outcomes.js'

it('distinguishes measured free work from partially unpriced usage', () => {
  const task = {
    id: 'task', status: 'completed', intent: 'analyze', outcome: 'answered',
    createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:01:00Z',
    assignment: { planner: 'codex', implementer: 'codex', reviewer: 'codex' },
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, unpricedTokens: 0 },
    fixRound: 0
  } as Task
  expect(outcomeFor(task, [])?.costUsd).toBe(0)
  task.usage.unpricedTokens = 2
  expect(outcomeFor(task, [])?.costUsd).toBeNull()
  task.usage.costUsd = .2
  expect(outcomeFor(task, [])?.costUsd).toBeNull()
})
