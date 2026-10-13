import { DURABLE_EVENT_TYPES, type CommandAck, type EngineSnapshot, type EventEnvelope, type TaskDetail, type TaskDiff } from '@hydra/protocol'
import { Channel, clientHandshake, fromHex, keyPairFromSecret, type Frame, type ServerHello } from '@hydra/secure-channel'
import type { ConnectionStatus, Transport } from './transport'

export interface RemoteCredentials { deviceSecret: string; enginePub: string; deviceName: string }
export interface Welcome { deviceId: string; name: string; scopes: string[]; expiresAt: string }

const STORAGE_KEY = 'hydra.remote.device'

export function loadCredentials(): RemoteCredentials | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as RemoteCredentials | null } catch { return null }
}
export function saveCredentials(credentials: RemoteCredentials): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials))
}
export function forgetCredentials(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }

/**
 * Transport for the phone: every request and event travels inside the
 * end-to-end encrypted channel (docs/v2/REMOTE.md).
 */
export class RemoteTransport implements Transport {
  readonly kind = 'remote' as const
  private ws: WebSocket | null = null
  private channel: Channel | null = null
  private readonly pending = new Map<string, Pending>()
  private onEvent: ((envelope: EventEnvelope) => void) | null = null
  private onStatus: ((status: ConnectionStatus) => void) | null = null
  private stopped = false
  private attempt = 0
  private ready: Promise<Welcome> | null = null
  /** Highest journal sequence number this phone has applied; used to catch up after a disconnect. */
  private cursor = 0
  private connectedOnce = false
  welcome: Welcome | null = null

  constructor(private readonly origin: string, private readonly credentials: RemoteCredentials, private pairing: { id: string; secret: Uint8Array } | null = null) {}

  /** Opens the channel (pairing on first use). Resolves once the engine has authenticated this device. */
  connect(): Promise<Welcome> {
    this.ready = new Promise<Welcome>((resolve, reject) => {
      const device = keyPairFromSecret(fromHex(this.credentials.deviceSecret))
      const handshake = clientHandshake(device, fromHex(this.credentials.enginePub), this.pairing?.id ?? null)
      const ws = new WebSocket(`${this.origin.replace(/^http/, 'ws')}/remote/channel`)
      this.ws = ws
      let opened = false
      ws.onopen = () => ws.send(JSON.stringify(handshake.hello))
      ws.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>
        if (!this.channel) {
          this.channel = new Channel(handshake.finish(data as unknown as ServerHello, this.pairing?.secret ?? null))
          ws.send(JSON.stringify(this.channel.seal({ type: 'auth', name: this.credentials.deviceName })))
          return
        }
        const message = this.channel.open<Record<string, unknown>>(data as unknown as Frame)
        if (message.type === 'welcome') {
          opened = true
          this.attempt = 0
          this.pairing = null // pairing is single use; later connections authenticate by device key
          this.welcome = message as unknown as Welcome
          resolve(this.welcome)
          // After a reconnect, replay what was missed before reporting the connection as live.
          if (this.connectedOnce) void this.catchUp().finally(() => this.onStatus?.('live'))
          else this.onStatus?.('live')
          this.connectedOnce = true
        } else if (typeof message.ack === 'string') {
          this.pending.get(message.ack)?.resolve(message)
          this.pending.delete(message.ack)
        } else if (message.event) {
          this.deliver(message.event as EventEnvelope)
        }
      }
      ws.onclose = (event) => {
        this.channel = null
        for (const pending of this.pending.values()) pending.reject(new Error('Connection lost'))
        this.pending.clear()
        if (!opened) reject(new Error(event.code === 4401 ? 'This phone is not (or no longer) paired with that Hydra. Pair again from the desktop.' : `Could not reach Hydra (${event.code}).`))
        if (this.stopped || event.code === 4401 || event.code === 4403) { this.onStatus?.('offline'); return }
        this.attempt++
        this.onStatus?.(this.attempt > 3 ? 'offline' : 'reconnecting')
        setTimeout(() => { if (!this.stopped) void this.connect().catch(() => {}) }, Math.min(15_000, 600 * 2 ** Math.min(this.attempt, 5)))
      }
    })
    return this.ready
  }

  private async request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.ready
    if (!this.channel || !this.ws) throw new Error('Not connected to Hydra')
    const id = crypto.getRandomValues(new Uint32Array(2)).join('-')
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error('Hydra did not answer in time')) }, 30_000)
    })
    this.ws.send(JSON.stringify(this.channel.seal({ ...body, id })))
    return promise
  }

  /** Applies an event once: journal events at or below the cursor were already applied. */
  private deliver(envelope: EventEnvelope): void {
    if (DURABLE_EVENT_TYPES.has(envelope.event.type)) {
      if (envelope.seq <= this.cursor) return
      this.cursor = envelope.seq
    }
    this.onEvent?.(envelope)
  }

  private async catchUp(): Promise<void> {
    for (let rounds = 0; rounds < 20; rounds++) {
      const page = await this.query<{ events: EventEnvelope[]; lastSeq: number; complete: boolean }>('events', undefined, { after: this.cursor }).catch(() => null)
      if (!page) return
      for (const envelope of page.events) this.deliver(envelope)
      this.cursor = Math.max(this.cursor, page.lastSeq)
      if (page.complete) return
    }
  }

  private async query<T>(query: string, taskId?: string, extra: Record<string, unknown> = {}): Promise<T> {
    const reply = await this.request({ kind: 'query', query, taskId, ...extra })
    if (!reply.ok) throw new Error((reply.error as { message?: string } | undefined)?.message ?? 'Request failed')
    return reply.result as T
  }

  snapshot() { return this.query<EngineSnapshot>('snapshot') }
  taskDetail(taskId: string) { return this.query<TaskDetail>('task', taskId) }
  taskDiff(taskId: string) { return this.query<TaskDiff>('diff', taskId) }
  async evidenceLog(): Promise<string> { throw new Error('Full logs are available on the desktop.') }

  async execute(command: Record<string, unknown>): Promise<CommandAck> {
    const reply = await this.request({ kind: 'command', command })
    return reply.ok ? { ok: true, result: reply.result } : { ok: false, error: reply.error as { code: 'invalid'; message: string } }
  }

  stream(after: number, onEvent: (envelope: EventEnvelope) => void, onStatus: (status: ConnectionStatus) => void): () => void {
    this.cursor = Math.max(this.cursor, after)
    this.onEvent = onEvent
    this.onStatus = onStatus
    onStatus(this.channel ? 'live' : 'connecting')
    return () => { this.stopped = true; this.ws?.close() }
  }
}
