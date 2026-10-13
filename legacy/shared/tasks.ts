import type { ProviderId } from './types'

export type PermissionMode = 'safe' | 'developer' | 'autonomous'
export type TaskPhase = 'planning' | 'awaiting_approval' | 'queued' | 'implementation' | 'review' | 'repair' | 'verification' | 'synthesis' | 'completed' | 'blocked' | 'failed' | 'canceled' | 'interrupted'
export type TaskRole = 'analysis' | 'implementation' | 'review' | 'repair' | 'verification' | 'synthesis'
export interface TaskAttachment { name: string; content: string }
export interface TaskMessage { id: string; role: 'user' | 'hydra'; content: string; createdAt: string; attachments?: TaskAttachment[] }
export interface TaskEvidence { command: string; exitCode: number | null; output: string; runId: string; kind?: 'command' | 'file'; tool?: string }
export interface ProviderExecutionResult { text: string; sessionId: string | null; terminal: boolean; failed: boolean; error: string | null; evidence: TaskEvidence[]; permissionDenied: boolean; fileTools?: Record<string, { name: string; path: string }> }
export interface TaskAttempt {
  id: string; provider: ProviderId; role: TaskRole; status: 'running' | 'completed' | 'failed' | 'canceled'
  runId: string | null; sessionId: string | null; startedAt: string; endedAt: string | null
  summary: string; logs: string; evidence: TaskEvidence[]; error: string | null
}
export interface TaskFinding { id: string; provider: ProviderId; text: string; disposition: 'open' | 'addressed' | 'unresolved' }
export interface TaskApproval { id: string; reason: string; scope: string; status: 'pending' | 'approved' | 'denied'; createdAt: string }
export interface TaskEvent { sequence: number; at: string; phase: TaskPhase; text: string }
export interface HydraTask {
  id: string; title: string; projectDir: string; permissionMode: PermissionMode; providers: ProviderId[]
  intent: 'analyze' | 'implement'; intentOverride?: 'auto' | 'analyze' | 'implement'; phase: TaskPhase; createdAt: string; updatedAt: string
  messages: TaskMessage[]; attempts: TaskAttempt[]; findings: TaskFinding[]; decisions: string[]
  events: TaskEvent[]; approval: TaskApproval | null; writer: ProviderId | null
  repairRounds: number; error: string | null; repository: string; relevantFiles: string[]
  verificationPlan?: string[]; contextFingerprint?: string; contextOmissions?: string[]
}
export interface CreateTaskPayload { projectDir: string; prompt: string; providers: ProviderId[]; permissionMode: PermissionMode; intent: 'auto' | 'analyze' | 'implement'; attachments?: TaskAttachment[] }
export type TaskCommand =
  | { action: 'rename'; title: string }
  | { action: 'cancel' }
  | { action: 'approve'; approvalId: string; approved: boolean }
  | { action: 'message'; prompt: string; attachments?: TaskAttachment[] }
  | { action: 'retry' | 'continue' }
export const TASK_ACTIVE_PHASES: TaskPhase[] = ['planning', 'queued', 'implementation', 'review', 'repair', 'verification', 'synthesis']
