import type { HydraTask } from './tasks'
export interface RemoteTaskSummary { kind: 'task'; taskId: string; title: string; phase: string; projectName: string; providers: string[]; updatedAt: string; approvalRequired: boolean; summary: string; error: string | null }
/** Remote is an explicit bounded projection: omit structured CLI logs, attachments, project roots and approval payloads. Response prose may mention paths. */
export function remoteTaskSummary(task: HydraTask): RemoteTaskSummary {
  return { kind: 'task', taskId: task.id, title: task.title.slice(0, 120), phase: task.phase,
    projectName: task.projectDir.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? 'Project', providers: task.providers,
    updatedAt: task.updatedAt, approvalRequired: task.approval?.status === 'pending',
    summary: [...task.messages].reverse().find(v => v.role === 'hydra')?.content.slice(0, 8000) ?? '', error: task.error?.slice(0, 1500) ?? null }
}
