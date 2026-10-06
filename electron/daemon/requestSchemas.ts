import { z } from 'zod'
import { MAX_CONCURRENT_AGENTS_HARD_LIMIT } from '@shared/types'

export const idSchema = z.string().trim().min(1).max(128)
export const projectDirSchema = z.string().trim().min(1).max(4096)
export const providerSchema = z.enum(['claude', 'codex', 'opencode'])
export const modelSchema = z.string().trim().min(1).max(128)

export const createAgentSchema = z.object({
  name: z.string().trim().max(120),
  projectDir: projectDirSchema,
  provider: providerSchema,
  model: modelSchema,
  reasoningEffort: z.string().trim().max(32).optional(),
  yolo: z.literal(false),
  initialPrompt: z.string().max(20_000),
  resumeSessionId: idSchema.nullable().optional(),
  isManager: z.boolean().optional(),
  workMode: z.enum(['local', 'worktree']).optional()
}).strict()

export const inputSchema = z.object({ input: z.string().max(20_000) }).strict()
export const rawInputSchema = z.object({ data: z.string().max(20_000) }).strict()
export const resizeSchema = z.object({
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(2).max(1000)
}).strict()
export const renameSchema = z.object({ name: z.string().trim().min(1).max(120) }).strict()
export const modelUpdateSchema = z.object({ model: modelSchema }).strict()
export const yoloSchema = z.object({ yolo: z.literal(false) }).strict()
export const broadcastSchema = z.object({
  projectDir: projectDirSchema,
  input: z.string().max(20_000)
}).strict()
export const preflightSchema = z.object({ provider: providerSchema.optional() }).strict()

export const configPatchSchema = z.object({
  schemaVersion: z.number().int().min(1).max(100).optional(),
  defaultProvider: providerSchema.optional(),
  defaultModel: modelSchema.optional(),
  globalYolo: z.literal(false).optional(),
  maxAgents: z.number().int().min(1).max(MAX_CONCURRENT_AGENTS_HARD_LIMIT).optional(),
  theme: z.enum(['light', 'dark', 'midnight']).optional(),
  defaultViewMode: z.enum(['grid', 'chat']).optional(),
  gridColumns: z.union([z.literal('auto'), z.literal(2), z.literal(3)]).optional(),
  defaultProjectDir: z.string().max(4096).optional(),
  defaultEditor: z.enum(['vscode', 'cursor', 'windsurf', 'antigravity', 'zed', 'finder', 'terminal']).optional(),
  importSessionsOnStartup: z.boolean().optional(),
  sessionImportLimit: z.number().int().min(0).max(20_000).optional(),
  sessionMaxAgeDays: z.number().int().min(0).max(365).optional(),
  sessionImportProjectPrefix: z.string().max(4096).optional(),
  hiddenSessionIds: z.array(idSchema).max(10_000).optional(),
  enableSoundEffects: z.boolean().optional(),
  enableRemoteErrorReporting: z.boolean().optional(),
  errorReportingEndpoint: z.string().max(1024).optional(),
  includeSensitiveDiagnostics: z.boolean().optional(),
  remoteControlEnabled: z.boolean().optional(),
  remoteSessionTimeoutMinutes: z.number().int().min(30).max(1440).optional(),
  terminalShellMode: z.enum(['auto', 'direct', 'login', 'custom']).optional(),
  terminalShellPath: z.string().max(4096).optional(),
  terminalShellArgs: z.string().max(1024).optional(),
  terminalFontFamily: z.string().max(256).optional(),
  terminalFontSize: z.number().int().min(8).max(32).optional(),
  terminalCursorStyle: z.enum(['block', 'bar', 'underline']).optional(),
  terminalCursorBlink: z.boolean().optional(),
  terminalEnableWebgl: z.boolean().optional(),
  freeTerminalLifecyclePolicy: z.enum(['explicit', 'lru', 'idle']).optional(),
  freeTerminalMaxCount: z.number().int().min(1).max(50).optional(),
  freeTerminalIdleTimeoutMinutes: z.number().int().min(1).max(1440).optional(),
  freeTerminalScrollbackLines: z.number().int().min(100).max(100_000).optional(),
  gitPanelDisplayMode: z.enum(['overlay', 'split']).optional(),
  editorPanelDisplayMode: z.enum(['overlay', 'split']).optional()
}).strict()

export const headlessStartSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  projectDir: projectDirSchema,
  provider: providerSchema,
  model: modelSchema,
  reasoningEffort: z.string().trim().max(32).optional(),
  resumeSessionId: idSchema.nullable().optional(),
  accessMode: z.enum(['context-only', 'read-only', 'project-write']).optional()
}).strict()

export const skillToggleSchema = z.object({
  provider: providerSchema,
  id: z.string().trim().min(1).max(256),
  enabled: z.boolean()
}).strict()
export const terminalInputSchema = z.object({ data: z.string().max(20_000) }).strict()
export const terminalResizeSchema = resizeSchema
export const freeTerminalSpawnSchema = z.object({
  projectDir: projectDirSchema,
  cwd: projectDirSchema.optional(),
  groupId: idSchema.optional()
}).strict()
export const terminalIdSchema = z.object({ terminalId: idSchema }).strict()
export const freeTerminalInputSchema = z.object({
  terminalId: idSchema,
  data: z.string().max(20_000)
}).strict()
export const freeTerminalResizeSchema = z.object({
  terminalId: idSchema,
  cols: z.number().int().min(2).max(1000),
  rows: z.number().int().min(2).max(1000)
}).strict()
export const freeTerminalActivateSchema = z.object({
  projectDir: projectDirSchema,
  groupId: idSchema.optional(),
  paneId: idSchema.optional()
}).strict()

export const sessionQuerySchema = z.object({
  provider: providerSchema.default('claude'),
  limit: z.coerce.number().int().min(1).max(20_000).optional(),
  maxAgeDays: z.coerce.number().int().min(1).max(365).optional(),
  projectPathPrefix: z.string().trim().min(1).max(4096).optional()
})
export const headlessQuerySchema = z.object({
  query: z.string().max(2000).optional(),
  status: z.enum(['running', 'completed', 'errored', 'canceled', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional()
})
export const logQuerySchema = z.object({
  tailLines: z.coerce.number().int().min(1).max(5000).optional(),
  maxChars: z.coerce.number().int().min(200).max(500_000).optional()
})
export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
})

export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params.entries())
}
