import type { AutonomyMode, Budget } from '@hydra/protocol'

/**
 * Enforced behaviour per autonomy mode. Every field here is checked by engine
 * code; nothing in this object is merely a prompt instruction.
 */
export interface Policy {
  mode: AutonomyMode
  requirePlanApproval: boolean
  /** In safe mode the plan approval also approves the exact check commands shown. */
  requireCheckApproval: boolean
  defaultBudget: Budget
  agentTimeoutMinutes: number
}

const POLICIES: Record<AutonomyMode, Policy> = {
  safe: {
    mode: 'safe', requirePlanApproval: true, requireCheckApproval: true, agentTimeoutMinutes: 15,
    defaultBudget: { maxCostUsd: 2, maxTokens: 2_000_000, maxWallMinutes: 30, maxAgentRuns: 8, maxFixRounds: 1 }
  },
  developer: {
    mode: 'developer', requirePlanApproval: false, requireCheckApproval: false, agentTimeoutMinutes: 20,
    defaultBudget: { maxCostUsd: 5, maxTokens: 5_000_000, maxWallMinutes: 60, maxAgentRuns: 12, maxFixRounds: 2 }
  },
  autonomous: {
    mode: 'autonomous', requirePlanApproval: false, requireCheckApproval: false, agentTimeoutMinutes: 30,
    defaultBudget: { maxCostUsd: 15, maxTokens: 15_000_000, maxWallMinutes: 120, maxAgentRuns: 24, maxFixRounds: 4 }
  }
}

export const policyFor = (mode: AutonomyMode): Policy => POLICIES[mode]
