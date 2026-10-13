import { describe, expect, it } from 'vitest'
import { emptyUsage, type Task } from '@hydra/protocol'
import { afterFinalDecision, afterPlanDecision, firstStep, nextStep } from './machine.js'
import { policyFor } from './policy.js'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', projectId: 'p1', title: 't', prompt: 'p', intent: 'change', route: null, followUpOf: null, mode: 'developer',
  assignment: { planner: 'claude', implementer: 'codex', reviewer: 'claude' },
  budget: { maxCostUsd: 5, maxTokens: 1e6, maxWallMinutes: 60, maxAgentRuns: 10, maxFixRounds: 2 },
  status: 'running', stage: 'plan', waitReason: null, outcome: null, fixRound: 0, plan: null, review: null, checks: [],
  checksApproved: true, checkDigest: null, applyIntent: null, demo: null, answer: null, workspace: null, applied: null, usage: emptyUsage(), stages: [], feedback: [],
  error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over
})
const dev = policyFor('developer')
const safe = policyFor('safe')

describe('workflow machine', () => {
  it('always starts with planning', () => {
    expect(firstStep()).toEqual({ kind: 'run', stage: 'plan' })
  })

  it('completes analysis tasks after planning without touching code', () => {
    expect(nextStep(task({ intent: 'analyze' }), { stage: 'plan', ok: true }, safe)).toEqual({ kind: 'complete', outcome: 'answered' })
  })

  it('waits for plan approval in safe mode only', () => {
    expect(nextStep(task({ mode: 'safe' }), { stage: 'plan', ok: true }, safe)).toEqual({ kind: 'wait', reason: 'plan_approval' })
    expect(nextStep(task(), { stage: 'plan', ok: true }, dev)).toEqual({ kind: 'run', stage: 'implement' })
  })

  it('always reviews after implement and after fix', () => {
    expect(nextStep(task(), { stage: 'implement', ok: true }, dev)).toEqual({ kind: 'run', stage: 'review' })
    expect(nextStep(task(), { stage: 'fix', ok: true }, dev)).toEqual({ kind: 'run', stage: 'review' })
  })

  it('fixes rejected reviews while rounds remain, then proceeds to verify', () => {
    expect(nextStep(task({ fixRound: 1 }), { stage: 'review', ok: true, approved: false }, dev)).toEqual({ kind: 'run', stage: 'fix' })
    expect(nextStep(task({ fixRound: 2 }), { stage: 'review', ok: true, approved: false }, dev)).toEqual({ kind: 'run', stage: 'verify' })
    expect(nextStep(task(), { stage: 'review', ok: true, approved: true }, dev)).toEqual({ kind: 'run', stage: 'verify' })
  })

  it('loops back to fix on failing required checks, bounded by the fix budget', () => {
    expect(nextStep(task({ fixRound: 0 }), { stage: 'verify', ok: true, requiredFailures: 2 }, dev)).toEqual({ kind: 'run', stage: 'fix' })
    expect(nextStep(task({ fixRound: 2 }), { stage: 'verify', ok: true, requiredFailures: 2 }, dev)).toEqual({ kind: 'run', stage: 'demo' })
    expect(nextStep(task(), { stage: 'verify', ok: true, requiredFailures: 0 }, dev)).toEqual({ kind: 'run', stage: 'demo' })
  })

  it('never applies without a human: demo always ends in final approval', () => {
    for (const mode of ['safe', 'developer', 'autonomous'] as const) {
      expect(nextStep(task({ mode }), { stage: 'demo', ok: true }, policyFor(mode))).toEqual({ kind: 'wait', reason: 'final_approval' })
    }
  })

  it('cannot loop forever: with zero fix rounds every path reaches approval', () => {
    let t = task({ budget: { ...task().budget, maxFixRounds: 0 } })
    const results = [
      { stage: 'plan', ok: true }, { stage: 'implement', ok: true }, { stage: 'review', ok: true, approved: false },
      { stage: 'verify', ok: true, requiredFailures: 3 }, { stage: 'demo', ok: true }
    ] as const
    const steps = results.map((r) => nextStep(t, r, dev))
    expect(steps.map((s) => (s.kind === 'run' ? s.stage : s.kind))).toEqual(['implement', 'review', 'verify', 'demo', 'wait'])
    t = task()
    expect(t.fixRound).toBe(0)
  })

  it('turns stage failures into task failures with the stage name', () => {
    expect(nextStep(task(), { stage: 'implement', ok: false, error: 'boom' }, dev)).toEqual({ kind: 'fail', error: 'implement failed: boom' })
  })

  it('maps human decisions', () => {
    expect(afterPlanDecision(true)).toEqual({ kind: 'run', stage: 'implement' })
    expect(afterPlanDecision(false)).toEqual({ kind: 'complete', outcome: 'discarded' })
    expect(afterFinalDecision('accept')).toEqual({ kind: 'run', stage: 'apply' })
    expect(afterFinalDecision('request_changes')).toEqual({ kind: 'run', stage: 'fix' })
    expect(afterFinalDecision('reject')).toEqual({ kind: 'complete', outcome: 'discarded' })
    expect(afterFinalDecision('keep_branch')).toEqual({ kind: 'complete', outcome: 'kept_branch' })
  })

  it('completes as applied after a successful apply', () => {
    expect(nextStep(task(), { stage: 'apply', ok: true }, dev)).toEqual({ kind: 'complete', outcome: 'applied' })
  })
})
