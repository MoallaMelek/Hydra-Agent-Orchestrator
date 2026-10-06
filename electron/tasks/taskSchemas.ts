import { z } from 'zod'

const attachments = z.array(z.object({ name: z.string().min(1).max(200).refine(name => !/(?:^|[\\/])\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$|(?:auth|token|credential|secret|service[-_]?account)[^\\/]*\.json$/i.test(name), 'Credential attachments are not accepted'), content: z.string().max(16000) }).strict()).max(8).optional()
const prompt = z.string().trim().min(1).max(20000)
export const createTaskSchema = z.object({
  projectDir: z.string().trim().min(1).max(4096), prompt,
  providers: z.array(z.enum(['claude', 'codex', 'opencode'])).min(1).max(3).refine(v => new Set(v).size === v.length),
  permissionMode: z.enum(['safe', 'developer', 'autonomous']), intent: z.enum(['auto', 'analyze', 'implement']), attachments
}).strict()
export const taskCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('rename'), title: z.string().trim().min(1).max(120) }).strict(),
  z.object({ action: z.literal('cancel') }).strict(),
  z.object({ action: z.literal('approve'), approvalId: z.string().uuid(), approved: z.boolean() }).strict(),
  z.object({ action: z.literal('message'), prompt, attachments }).strict(),
  z.object({ action: z.literal('retry') }).strict(), z.object({ action: z.literal('continue') }).strict()
])
