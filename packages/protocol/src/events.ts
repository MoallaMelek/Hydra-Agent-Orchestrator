import { z } from 'zod'
import { AgentRunInfo, Evidence, IsoTime, Project, RunActivity, Task, Device, ProviderStatus } from './domain.js'

/**
 * Events published by the engine to clients. Persisted journal entries and live
 * notifications share one envelope; `seq` is the global journal sequence number,
 * so a client can resume a stream with `after=<lastSeq>`.
 */
export const EngineEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task.updated'), task: Task }),
  z.object({ type: z.literal('task.deleted'), taskId: z.string() }),
  z.object({ type: z.literal('task.log'), taskId: z.string(), level: z.enum(['info', 'warn', 'error']), message: z.string().max(4000) }),
  z.object({ type: z.literal('run.updated'), run: AgentRunInfo }),
  z.object({ type: z.literal('run.output'), runId: z.string(), taskId: z.string(), text: z.string().max(16_000), /** 'answer': streamed reply text; otherwise activity lines. */ stream: z.enum(['answer', 'log']).optional() }),
  /** A tool call reported by a running agent (live only; the run record keeps the list). */
  z.object({ type: z.literal('run.activity'), runId: z.string(), taskId: z.string(), activity: RunActivity }),
  z.object({ type: z.literal('evidence.recorded'), evidence: Evidence }),
  z.object({ type: z.literal('project.updated'), project: Project }),
  z.object({ type: z.literal('project.removed'), projectId: z.string() }),
  z.object({ type: z.literal('providers.updated'), providers: z.array(ProviderStatus) }),
  z.object({ type: z.literal('device.updated'), device: Device })
])
export type EngineEvent = z.infer<typeof EngineEvent>

export const EventEnvelope = z.object({
  seq: z.number().int().nonnegative(),
  at: IsoTime,
  event: EngineEvent
})
export type EventEnvelope = z.infer<typeof EventEnvelope>

/** Events that are recorded in the durable journal (the rest are live-only, e.g. streaming output). */
export const DURABLE_EVENT_TYPES = new Set<EngineEvent['type']>([
  'task.updated', 'task.deleted', 'task.log', 'run.updated', 'evidence.recorded', 'project.updated', 'project.removed', 'device.updated'
])
