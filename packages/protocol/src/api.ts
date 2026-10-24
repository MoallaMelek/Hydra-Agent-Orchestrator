import { z } from 'zod'
import { Device, Project, ProviderId, ProviderStatus, Task, AgentRunInfo, Evidence } from './domain.js'

/** Snapshot returned by GET /api/state, enough to render the whole app on load. */
export const EngineSnapshot = z.object({
  protocolVersion: z.number().int(),
  engineVersion: z.string(),
  lastSeq: z.number().int().nonnegative(),
  projects: z.array(Project),
  tasks: z.array(Task),
  providers: z.array(ProviderStatus),
  devices: z.array(Device),
  /** Agent processes running right now, across all tasks (absent from older engines). */
  activeRuns: z.array(AgentRunInfo).default([]),
  /** How many agent processes may run at once, across all tasks; work beyond this waits for a slot. */
  agentSlots: z.number().int().positive().default(3),
  remote: z.object({
    relayUrl: z.string().nullable(), connected: z.boolean(), addresses: z.array(z.object({ address: z.string(), label: z.string() })).default([]),
    /** Phone access is on (the listener runs). */
    enabled: z.boolean().default(false),
    /** When it switches itself off; null while off or when on until Hydra closes. */
    until: z.string().nullable().default(null),
    /** The only address it listens on. */
    host: z.string().nullable().default(null)
  })
})
export type EngineSnapshot = z.infer<typeof EngineSnapshot>

export const TaskHistoryQuery = z.object({
  projectId: z.string().min(1).max(100),
  before: z.object({ at: z.string().datetime(), id: z.string().min(1).max(100) }).optional(),
  query: z.string().max(200).default(''),
  archived: z.boolean().default(false)
})
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuery>
export const TaskSummary = Task.pick({ id: true, projectId: true, title: true, intent: true, status: true, stage: true, waitReason: true, outcome: true, archivedAt: true, updatedAt: true, followUpOf: true, mode: true, usage: true, createdAt: true })
export type TaskSummary = z.infer<typeof TaskSummary>
export const TaskHistoryPage = z.object({ tasks: z.array(TaskSummary), next: z.object({ at: z.string(), id: z.string() }).nullable() })
export type TaskHistoryPage = z.infer<typeof TaskHistoryPage>

export const TaskDetail = z.object({
  task: Task,
  runs: z.array(AgentRunInfo),
  evidence: z.array(Evidence)
})
export type TaskDetail = z.infer<typeof TaskDetail>

export const DiffFile = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum(['added', 'modified', 'deleted', 'renamed', 'binary']),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string()
})
export type DiffFile = z.infer<typeof DiffFile>

export const TaskDiff = z.object({ baseSha: z.string(), headSha: z.string(), files: z.array(DiffFile), truncated: z.boolean() })
export type TaskDiff = z.infer<typeof TaskDiff>

/**
 * Ask the user's own provider CLI to explain one record selected on a map, in plain English.
 * Read-only: the agent may read the project but cannot change it. The answer is not stored.
 */
export const ExplainRequest = z.object({
  projectId: z.string().min(1).max(100),
  taskId: z.string().min(1).max(100).nullable().default(null),
  kind: z.enum(['mission', 'agent', 'stage', 'run', 'file', 'revision', 'check', 'finding', 'decision']),
  title: z.string().max(300),
  /** What Hydra recorded about it, assembled by the client from the records. */
  facts: z.string().max(16_000),
  /** Repository-relative file the record is about, when there is one. */
  file: z.string().max(500).nullable().default(null)
})
export type ExplainRequest = z.infer<typeof ExplainRequest>
export const ExplainResult = z.object({
  text: z.string(),
  provider: ProviderId,
  model: z.string().nullable(),
  tokens: z.number().int().nonnegative(),
  costUsd: z.number().nullable(),
  /** Where the agent could read: the mission's own copy, or the project folder. */
  readFrom: z.enum(['workspace', 'project'])
})
export type ExplainResult = z.infer<typeof ExplainResult>
