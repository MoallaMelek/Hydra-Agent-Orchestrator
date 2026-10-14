import { z } from 'zod'
import { Assignment, AutonomyMode, Budget, CheckDraft, DeviceScope, Id, TaskIntent } from './domain.js'
import { DepthChoice } from './route.js'

const Feedback = z.string().trim().min(1).max(10_000)

/**
 * Every state-changing request is a Command. The same union is accepted from the
 * desktop API and (subject to device scopes) from paired remote devices.
 */
export const Command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.add'), root: z.string().min(1).max(4096), name: z.string().trim().min(1).max(200).optional() }),
  z.object({ type: z.literal('project.remove'), projectId: Id }),
  /** Verification commands: see which apply, save your own list (null restores detection), test one. Desktop only. */
  z.object({ type: z.literal('project.checks.get'), projectId: Id }),
  z.object({ type: z.literal('project.checks.set'), projectId: Id, checks: z.array(CheckDraft).max(30).nullable() }),
  z.object({ type: z.literal('project.checks.test'), projectId: Id, check: CheckDraft }),
  z.object({
    type: z.literal('task.create'),
    projectId: Id,
    prompt: z.string().trim().min(1).max(50_000),
    title: z.string().trim().max(200).optional(),
    /** Optional when depth is given: Hydra derives it from the route. */
    intent: TaskIntent.optional(),
    /** auto (default): Hydra classifies the request; or force fast / standard / deep. */
    depth: DepthChoice.optional(),
    /** Continue a previous question: its question and answer are given to the agent as context. */
    followUpOf: Id.optional(),
    mode: AutonomyMode,
    assignment: Assignment,
    budget: Budget.partial().optional()
  }),
  z.object({ type: z.literal('task.cancel'), taskId: Id }),
  /** Turns phone access on for a number of minutes (0: until Hydra closes), on one address. Desktop only. */
  z.object({ type: z.literal('remote.enable'), minutes: z.number().int().min(0).max(24 * 60), host: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).optional() }),
  z.object({ type: z.literal('remote.disable') }),
  /** Suggested agents for a message (or a depth), with the local evidence behind it. */
  z.object({ type: z.literal('agents.recommend'), prompt: z.string().max(50_000).optional(), depth: DepthChoice.optional() }),
  /** Local outcome history: summary, or delete it (desktop only). */
  z.object({ type: z.literal('outcomes.get') }),
  z.object({ type: z.literal('outcomes.clear') }),
  /** Starts an answering agent ahead of time for this project so the next question is faster. */
  z.object({ type: z.literal('agent.prewarm'), projectId: Id }),
  z.object({ type: z.literal('task.resume'), taskId: Id }),
  z.object({ type: z.literal('task.approve_plan'), taskId: Id, approve: z.boolean(), note: z.string().max(10_000).optional() }),
  z.object({
    type: z.literal('task.decide'), taskId: Id, decision: z.enum(['accept', 'request_changes', 'reject', 'keep_branch']), feedback: Feedback.optional(),
    /** The exact commit the person reviewed. Required to accept: stale decisions are refused. */
    headSha: z.string().regex(/^[0-9a-f]{40}$/).optional()
  }),
  z.object({ type: z.literal('task.rollback'), taskId: Id }),
  z.object({ type: z.literal('task.delete'), taskId: Id }),
  /** Archives (or restores) a task and the rest of its conversation. */
  z.object({ type: z.literal('task.archive'), taskId: Id, archived: z.boolean() }),
  z.object({ type: z.literal('device.pair_start'), name: z.string().trim().min(1).max(80), scopes: z.array(DeviceScope).min(1), host: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/).optional() }),
  z.object({ type: z.literal('device.revoke'), deviceId: Id }),
  z.object({ type: z.literal('providers.refresh') })
])
export type Command = z.infer<typeof Command>
export type CommandType = Command['type']

export const CommandError = z.object({
  code: z.enum(['invalid', 'not_found', 'conflict', 'forbidden', 'unavailable', 'internal']),
  message: z.string()
})
export type CommandError = z.infer<typeof CommandError>

export const CommandAck = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: CommandError })
])
export type CommandAck = z.infer<typeof CommandAck>

/** Minimum device scope required to issue each command remotely. Commands absent here are desktop-only. */
export const REMOTE_COMMAND_SCOPE: Partial<Record<CommandType, 'control' | 'approve'>> = {
  'task.create': 'control',
  'agent.prewarm': 'control',
  'agents.recommend': 'control',
  'task.archive': 'control',
  'task.cancel': 'control',
  'task.resume': 'control',
  'task.approve_plan': 'approve',
  'task.decide': 'approve',
  'task.rollback': 'approve'
}
