import type { ProviderId } from '@shared/types'
import type { ProviderExecutionResult } from '@shared/tasks'

export type SemanticResult = ProviderExecutionResult
export function emptySemanticResult(): SemanticResult { return { text: '', sessionId: null, terminal: false, failed: false, error: null, evidence: [], permissionDenied: false } }

/** Parse known provider semantics; process exit alone never proves task success. */
export function consumeProviderLine(provider: ProviderId, line: string, result: SemanticResult, runId: string): void {
  let event: any
  try { event = JSON.parse(line) } catch { return }
  const session = event.session_id || event.sessionId || event.thread_id
  if (typeof session === 'string') result.sessionId = session
  if (provider === 'claude') {
    if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
      result.text = (result.text + String(event.event.delta.text ?? '')).slice(-100000)
    }
    if (event.type === 'user') {
      for (const value of event.message?.content ?? []) if (value.type === 'tool_result' && !value.is_error) {
        const tool = result.fileTools?.[value.tool_use_id]
        if (!tool || tool.name !== 'Read') continue
        const text = typeof value.content === 'string' ? value.content : JSON.stringify(value.content)
        result.evidence.push({ command: `Read ${tool.path}`, kind: 'file', tool: 'Read', exitCode: 0, output: String(text).slice(-8000), runId })
        result.evidence = result.evidence.slice(-100)
      }
    }
    if (event.type === 'assistant') {
      for (const value of event.message?.content ?? []) if (value.type === 'tool_use' && ['Read', 'Write', 'Edit', 'Glob', 'Grep'].includes(value.name)) {
        result.fileTools ??= {}
        result.fileTools[value.id] = { name: value.name, path: String(value.input?.file_path ?? value.input?.path ?? '') }
      }
      const text = (event.message?.content ?? []).filter((v: any) => v.type === 'text').map((v: any) => v.text).join('\n')
      if (text) result.text = text.slice(-100000)
    }
    if (event.type === 'result') {
      result.terminal = true
      result.failed = event.is_error === true || (event.subtype && event.subtype !== 'success')
      if (typeof event.result === 'string') result.text = event.result.slice(-100000)
      if (result.failed) result.error = 'Claude reported a semantic failure'
      result.permissionDenied = Array.isArray(event.permission_denials) && event.permission_denials.length > 0
    }
  } else if (provider === 'codex') {
    if (event.type === 'item.completed' && event.item?.type === 'agent_message') result.text = String(event.item.text ?? '').slice(-100000)
    if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
      result.evidence.push({ command: String(event.item.command ?? ''), kind: 'command', exitCode: typeof event.item.exit_code === 'number' ? event.item.exit_code : null, output: String(event.item.aggregated_output ?? '').slice(-8000), runId })
      result.evidence = result.evidence.slice(-100)
    }
    if (event.type === 'turn.completed') result.terminal = true
    if (event.type === 'turn.failed' || event.type === 'error') {
      result.failed = true; result.terminal = true; result.error = 'Codex reported a semantic failure'
    }
  }
}
