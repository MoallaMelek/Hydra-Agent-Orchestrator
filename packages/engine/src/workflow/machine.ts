import type { Task, TaskOutcome, TaskStage, WaitReason } from '@hydra/protocol'
import type { Policy } from './policy.js'

/** What a stage runner reports back. Runners never decide what happens next. */
export type StageResult =
  | { stage: 'plan'; ok: true }
  | { stage: 'implement'; ok: true }
  | { stage: 'review'; ok: true; approved: boolean }
  | { stage: 'fix'; ok: true }
  | { stage: 'verify'; ok: true; requiredFailures: number }
  | { stage: 'demo'; ok: true }
  | { stage: 'apply'; ok: true }
  | { stage: TaskStage; ok: false; error: string }

export type Step =
  | { kind: 'run'; stage: TaskStage }
  | { kind: 'wait'; reason: WaitReason }
  | { kind: 'complete'; outcome: TaskOutcome }
  | { kind: 'fail'; error: string }

export type FinalDecision = 'accept' | 'request_changes' | 'reject' | 'keep_branch'

export const firstStep = (): Step => ({ kind: 'run', stage: 'plan' })

const canAutoFix = (task: Task): boolean => task.fixRound < task.budget.maxFixRounds

/**
 * Pure transition function. Given the persisted task and the result of the stage
 * that just finished, returns the next step. Exhaustively unit-tested.
 */
export function nextStep(task: Task, result: StageResult, policy: Policy): Step {
  if (!result.ok) return { kind: 'fail', error: `${result.stage} failed: ${result.error}` }
  switch (result.stage) {
    case 'plan':
      if (task.intent === 'analyze') return { kind: 'complete', outcome: 'answered' }
      // High-risk work always stops for the person, whatever the mode.
      return policy.requirePlanApproval || task.route?.risk === 'high' ? { kind: 'wait', reason: 'plan_approval' } : { kind: 'run', stage: 'implement' }
    case 'implement':
    case 'fix':
      return { kind: 'run', stage: 'review' }
    case 'review':
      if (result.approved) return { kind: 'run', stage: 'verify' }
      return canAutoFix(task) ? { kind: 'run', stage: 'fix' } : { kind: 'run', stage: 'verify' }
    case 'verify':
      if (result.requiredFailures > 0 && canAutoFix(task)) return { kind: 'run', stage: 'fix' }
      return { kind: 'run', stage: 'demo' }
    case 'demo':
      return { kind: 'wait', reason: 'final_approval' }
    case 'apply':
      return { kind: 'complete', outcome: 'applied' }
  }
}

export function afterPlanDecision(approved: boolean): Step {
  return approved ? { kind: 'run', stage: 'implement' } : { kind: 'complete', outcome: 'discarded' }
}

/** Human decisions are never limited by the automatic fix budget. */
export function afterFinalDecision(decision: FinalDecision): Step {
  switch (decision) {
    case 'accept': return { kind: 'run', stage: 'apply' }
    case 'request_changes': return { kind: 'run', stage: 'fix' }
    case 'reject': return { kind: 'complete', outcome: 'discarded' }
    case 'keep_branch': return { kind: 'complete', outcome: 'kept_branch' }
  }
}
