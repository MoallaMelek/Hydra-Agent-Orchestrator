import { z } from 'zod'
import { Device, Project, ProviderStatus, Task, AgentRunInfo, Evidence } from './domain.js'

/** Snapshot returned by GET /api/state, enough to render the whole app on load. */
export const EngineSnapshot = z.object({
  protocolVersion: z.number().int(),
  engineVersion: z.string(),
  lastSeq: z.number().int().nonnegative(),
  projects: z.array(Project),
  tasks: z.array(Task),
  providers: z.array(ProviderStatus),
  devices: z.array(Device),
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
