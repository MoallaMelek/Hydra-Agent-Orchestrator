import { z } from 'zod'

/** Bumped on any breaking change to persisted or wire formats. */
export const PROTOCOL_VERSION = 1

export const Id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
export const IsoTime = z.string().datetime({ offset: true })

export const ProviderId = z.enum(['claude', 'codex', 'scripted'])
export type ProviderId = z.infer<typeof ProviderId>

export const AgentRole = z.enum(['planner', 'implementer', 'reviewer'])
export type AgentRole = z.infer<typeof AgentRole>

export const AutonomyMode = z.enum(['safe', 'developer', 'autonomous'])
export type AutonomyMode = z.infer<typeof AutonomyMode>

export const TaskIntent = z.enum(['change', 'analyze'])
export type TaskIntent = z.infer<typeof TaskIntent>

export const STAGES = ['plan', 'implement', 'review', 'fix', 'verify', 'demo', 'approval', 'apply'] as const
export const TaskStage = z.enum(STAGES)
export type TaskStage = z.infer<typeof TaskStage>

export const TaskStatus = z.enum(['queued', 'running', 'waiting_input', 'paused', 'completed', 'failed', 'canceled'])
export type TaskStatus = z.infer<typeof TaskStatus>

export const TaskOutcome = z.enum(['applied', 'discarded', 'kept_branch', 'answered', 'rolled_back'])
export type TaskOutcome = z.infer<typeof TaskOutcome>

/** What Hydra is waiting for when status === 'waiting_input'. */
export const WaitReason = z.enum(['plan_approval', 'final_approval', 'stalled'])
export type WaitReason = z.infer<typeof WaitReason>

export const Budget = z.object({
  maxCostUsd: z.number().positive().max(1000),
  maxTokens: z.number().int().positive().max(100_000_000),
  maxWallMinutes: z.number().int().positive().max(24 * 60),
  maxAgentRuns: z.number().int().positive().max(100),
  maxFixRounds: z.number().int().min(0).max(10)
})
export type Budget = z.infer<typeof Budget>

export const Assignment = z.object({
  planner: ProviderId,
  implementer: ProviderId,
  reviewer: ProviderId
})
export type Assignment = z.infer<typeof Assignment>

export const UsageTotals = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  /**
   * Tokens from runs whose provider did not report a price (e.g. Codex CLI). Those
   * runs are bounded by the token budget only; costUsd does not include them.
   */
  unpricedTokens: z.number().int().nonnegative(),
  agentRuns: z.number().int().nonnegative()
})
export type UsageTotals = z.infer<typeof UsageTotals>

export const Plan = z.object({
  summary: z.string().min(1).max(4000),
  steps: z.array(z.string().min(1).max(1000)).min(1).max(30),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).min(1).max(20),
  risks: z.array(z.string().max(1000)).max(20),
  filesLikelyTouched: z.array(z.string().max(500)).max(100)
})
export type Plan = z.infer<typeof Plan>

export const Severity = z.enum(['blocker', 'major', 'minor', 'nit'])
export type Severity = z.infer<typeof Severity>

export const ReviewFinding = z.object({
  severity: Severity,
  file: z.string().max(500).nullable(),
  issue: z.string().min(1).max(2000),
  suggestion: z.string().max(2000)
})
export type ReviewFinding = z.infer<typeof ReviewFinding>

export const Review = z.object({
  verdict: z.enum(['approve', 'changes_requested']),
  summary: z.string().min(1).max(4000),
  findings: z.array(ReviewFinding).max(50),
  acceptanceCriteriaMet: z.array(z.object({ criterion: z.string().max(1000), met: z.boolean(), note: z.string().max(1000) })).max(20)
})
export type Review = z.infer<typeof Review>

export const Ecosystem = z.enum(['node', 'python', 'go', 'rust', 'java', 'cpp', 'custom'])
export type Ecosystem = z.infer<typeof Ecosystem>

export const CheckKind = z.enum(['build', 'typecheck', 'lint', 'test'])
export type CheckKind = z.infer<typeof CheckKind>

export const CheckSpec = z.object({
  id: z.string().min(1).max(80),
  ecosystem: Ecosystem,
  kind: CheckKind,
  label: z.string().max(200),
  argv: z.array(z.string().max(1000)).min(1).max(64),
  /** Relative to the workspace root. */
  cwd: z.string().max(500),
  timeoutSec: z.number().int().positive().max(3600),
  required: z.boolean()
})
export type CheckSpec = z.infer<typeof CheckSpec>

export const Evidence = z.object({
  id: Id,
  taskId: Id,
  checkId: z.string(),
  label: z.string(),
  phase: z.enum(['pre_review', 'verify', 'demo_base', 'demo_final']),
  commitSha: z.string().regex(/^[0-9a-f]{40}$/),
  argv: z.array(z.string()),
  cwd: z.string(),
  startedAt: IsoTime,
  durationMs: z.number().int().nonnegative(),
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  /** Spawn failure, e.g. tool not installed. */
  spawnError: z.string().nullable(),
  outputTail: z.string().max(20_000),
  outputBytes: z.number().int().nonnegative(),
  outputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Output exceeded the log quota and was cut off (exit code is still authoritative). */
  outputTruncated: z.boolean(),
  /** The check modified tracked files in its checkout; the result is flagged as untrustworthy. */
  treeMutated: z.boolean(),
  required: z.boolean()
})
export type Evidence = z.infer<typeof Evidence>

export const DemoReport = z.object({
  baseSha: z.string(),
  finalSha: z.string(),
  deltas: z.array(z.object({ checkId: z.string(), label: z.string(), before: z.enum(['pass', 'fail', 'error', 'missing']), after: z.enum(['pass', 'fail', 'error', 'missing']) })),
  narrative: z.string().max(4000)
})
export type DemoReport = z.infer<typeof DemoReport>

export const WorkspaceInfo = z.object({
  path: z.string(),
  /** Absolute git admin dir of this worktree; every engine git call is pinned to it. */
  gitDir: z.string(),
  branch: z.string(),
  baseSha: z.string(),
  headSha: z.string().nullable(),
  removed: z.boolean()
})
export type WorkspaceInfo = z.infer<typeof WorkspaceInfo>

export const AppliedInfo = z.object({
  targetBranch: z.string(),
  beforeSha: z.string(),
  afterSha: z.string(),
  /** Applies are always fast-forwards of a verified tree; 'none' = nothing new to apply. */
  method: z.enum(['fast_forward', 'none']),
  /** Set when the task branch had to integrate newer commits from the target and was re-verified. */
  integratedSha: z.string().nullable(),
  rolledBackSha: z.string().nullable()
})
export type AppliedInfo = z.infer<typeof AppliedInfo>

export const StageRecord = z.object({
  stage: TaskStage,
  attempt: z.number().int().positive(),
  status: z.enum(['running', 'succeeded', 'failed', 'interrupted', 'canceled', 'skipped']),
  startedAt: IsoTime,
  endedAt: IsoTime.nullable(),
  note: z.string().max(4000).nullable()
})
export type StageRecord = z.infer<typeof StageRecord>

export const AgentRunInfo = z.object({
  id: Id,
  taskId: Id,
  stage: TaskStage,
  role: AgentRole,
  provider: ProviderId,
  model: z.string().nullable(),
  status: z.enum(['running', 'succeeded', 'failed', 'canceled', 'interrupted']),
  startedAt: IsoTime,
  endedAt: IsoTime.nullable(),
  usage: UsageTotals,
  error: z.string().nullable(),
  pid: z.number().int().nullable(),
  /** Short rolling tail of agent text for live display. */
  tail: z.string().max(8000)
})
export type AgentRunInfo = z.infer<typeof AgentRunInfo>

export const Project = z.object({
  id: Id,
  name: z.string().min(1).max(200),
  root: z.string().min(1),
  isGit: z.boolean(),
  addedAt: IsoTime
})
export type Project = z.infer<typeof Project>

export const Task = z.object({
  id: Id,
  projectId: Id,
  title: z.string().max(200),
  prompt: z.string().min(1).max(50_000),
  intent: TaskIntent,
  mode: AutonomyMode,
  assignment: Assignment,
  budget: Budget,
  status: TaskStatus,
  stage: TaskStage,
  waitReason: WaitReason.nullable(),
  outcome: TaskOutcome.nullable(),
  fixRound: z.number().int().nonnegative(),
  plan: Plan.nullable(),
  review: Review.nullable(),
  checks: z.array(CheckSpec),
  checksApproved: z.boolean(),
  /**
   * Digest of the files that define the checks (package.json scripts, .hydra/checks.json,
   * build files) at plan time. If an agent changes them, Safe mode refuses to run checks
   * and every mode flags it for the reviewer and the human.
   */
  checkDigest: z.string().nullable(),
  /** Written before Hydra touches the user's branch, so a crash mid-apply can be reconciled. */
  applyIntent: z.object({ targetBranch: z.string(), beforeSha: z.string(), approvedSha: z.string(), startedAt: IsoTime }).nullable(),
  demo: DemoReport.nullable(),
  answer: z.string().nullable(),
  workspace: WorkspaceInfo.nullable(),
  applied: AppliedInfo.nullable(),
  usage: UsageTotals,
  stages: z.array(StageRecord),
  feedback: z.array(z.object({ at: IsoTime, text: z.string().max(10_000), source: z.enum(['desktop', 'remote']) })),
  error: z.string().nullable(),
  createdAt: IsoTime,
  updatedAt: IsoTime
})
export type Task = z.infer<typeof Task>

export const ProviderStatus = z.object({
  id: ProviderId,
  displayName: z.string(),
  installed: z.boolean(),
  path: z.string().nullable(),
  version: z.string().nullable(),
  /**
   * Whether the provider CLI reports a signed-in account. Hydra reads only this
   * flag and the method label; it never reads, stores or forwards credentials or
   * account identity (email, org). null = could not be determined.
   */
  authenticated: z.boolean().nullable(),
  authMethod: z.string().max(40).nullable(),
  capabilities: z.object({
    structuredOutput: z.boolean(),
    osSandbox: z.boolean(),
    fileToolConfinement: z.boolean(),
    reportsUsage: z.boolean(),
    reportsCost: z.boolean()
  }),
  problems: z.array(z.string())
})
export type ProviderStatus = z.infer<typeof ProviderStatus>

export const DeviceScope = z.enum(['view', 'control', 'approve'])
export type DeviceScope = z.infer<typeof DeviceScope>

export const Device = z.object({
  id: Id,
  name: z.string().max(80),
  scopes: z.array(DeviceScope),
  pairedAt: IsoTime,
  lastSeenAt: IsoTime.nullable(),
  expiresAt: IsoTime,
  revokedAt: IsoTime.nullable()
})
export type Device = z.infer<typeof Device>

export const emptyUsage = (): UsageTotals => ({ inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, unpricedTokens: 0, agentRuns: 0 })
