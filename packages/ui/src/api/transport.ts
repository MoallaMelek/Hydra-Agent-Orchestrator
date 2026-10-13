import type { CommandAck, EngineSnapshot, EventEnvelope, TaskDetail, TaskDiff } from '@hydra/protocol'

/**
 * Everything the UI needs from an engine. The desktop uses a direct HTTP/WS
 * transport; the phone uses the encrypted remote transport with the same shape.
 */
export interface Transport {
  readonly kind: 'local' | 'remote'
  snapshot(): Promise<EngineSnapshot>
  taskDetail(taskId: string): Promise<TaskDetail>
  taskDiff(taskId: string): Promise<TaskDiff>
  evidenceLog(evidenceId: string): Promise<string>
  execute(command: Record<string, unknown>): Promise<CommandAck>
  /** Streams events after `after`; calls onStatus as the connection changes. Returns a stop function. */
  stream(after: number, onEvent: (envelope: EventEnvelope) => void, onStatus: (status: ConnectionStatus) => void): () => void
}

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export class HttpTransport implements Transport {
  readonly kind = 'local' as const

  constructor(private readonly baseUrl: string, private readonly token: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
    })
    if (response.status === 401) throw new Error('The engine rejected the session token. Restart Hydra.')
    const text = await response.text()
    if (!response.ok && !text.startsWith('{')) throw new Error(`${response.status} ${response.statusText}`)
    const body = JSON.parse(text) as T & { error?: string }
    if (!response.ok && typeof body.error === 'string') throw new Error(body.error)
    return body
  }

  snapshot() { return this.request<EngineSnapshot>('/api/state') }
  taskDetail(taskId: string) { return this.request<TaskDetail>(`/api/tasks/${taskId}`) }
  taskDiff(taskId: string) { return this.request<TaskDiff>(`/api/tasks/${taskId}/diff`) }
  execute(command: Record<string, unknown>) { return this.request<CommandAck>('/api/commands', { method: 'POST', body: JSON.stringify(command) }) }

  async evidenceLog(evidenceId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/evidence/${evidenceId}/log`, { headers: { Authorization: `Bearer ${this.token}` } })
    if (!response.ok) throw new Error(`Log unavailable (${response.status})`)
    return response.text()
  }

  stream(after: number, onEvent: (envelope: EventEnvelope) => void, onStatus: (status: ConnectionStatus) => void): () => void {
    let cursor = after
    let socket: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/api/stream'
    const connect = () => {
      onStatus(attempt === 0 ? 'connecting' : 'reconnecting')
      socket = new WebSocket(wsUrl)
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'auth', token: this.token, after: cursor }))
      socket.onmessage = (message) => {
        const frame = JSON.parse(String(message.data)) as { type: string; envelope?: EventEnvelope }
        if (frame.type === 'ready') { attempt = 0; onStatus('live') }
        if (frame.type === 'event' && frame.envelope) {
          if (frame.envelope.event.type !== 'run.output' && frame.envelope.event.type !== 'providers.updated') cursor = Math.max(cursor, frame.envelope.seq)
          onEvent(frame.envelope)
        }
      }
      socket.onclose = () => {
        if (stopped) return
        attempt++
        onStatus(attempt > 3 ? 'offline' : 'reconnecting')
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempt, 5)))
      }
    }
    connect()
    return () => { stopped = true; if (timer) clearTimeout(timer); socket?.close() }
  }
}
