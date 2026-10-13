import { z } from 'zod'

const text = z.string()
const timestamp = z.string().datetime()
const phase = z.enum(['planning','awaiting_approval','queued','implementation','review','repair','verification','synthesis','completed','blocked','failed','canceled','interrupted'])
const provider = z.enum(['claude','codex','opencode'])
const evidence = z.object({ command: text, exitCode: z.number().nullable(), output: text, runId: text, kind: z.enum(['file','command']).optional(), tool: text.optional() })
export const persistedTaskSchema = z.object({
  id: z.string().uuid(), title: text, projectDir: text.min(1), permissionMode: z.enum(['safe','developer','autonomous']), providers: z.array(provider).min(1),
  intent: z.enum(['analyze','implement']), intentOverride: z.enum(['auto','analyze','implement']).optional(), phase, createdAt: timestamp, updatedAt: timestamp,
  messages: z.array(z.object({ id: text, role: z.enum(['user','hydra']), content: text, createdAt: timestamp, attachments: z.array(z.object({ name: text, content: text })).optional() })),
  attempts: z.array(z.object({ id: text, provider, role: z.enum(['analysis','implementation','review','repair','verification','synthesis']), status: z.enum(['running','completed','failed','canceled']), runId: text.nullable(), sessionId: text.nullable(), startedAt: timestamp, endedAt: timestamp.nullable(), summary: text, logs: text, evidence: z.array(evidence), error: text.nullable() })),
  findings: z.array(z.object({ id: text, provider, text, disposition: z.enum(['open','addressed','unresolved']) })), decisions: z.array(text),
  events: z.array(z.object({ sequence: z.number().int().positive(), at: timestamp, phase, text })),
  approval: z.object({ id: z.string().uuid(), reason: text, scope: text, status: z.enum(['pending','approved','denied']), createdAt: timestamp }).nullable(),
  writer: provider.nullable(), repairRounds: z.number().int().nonnegative(), error: text.nullable(), repository: text, relevantFiles: z.array(text),
  verificationPlan: z.array(text).optional(), contextFingerprint: text.optional(), contextOmissions: z.array(text).optional()
})
export const persistedTaskStoreSchema = z.object({ schemaVersion: z.literal(1), tasks: z.array(persistedTaskSchema).max(1000), projectDecisions: z.record(z.array(text)).default({}) })
