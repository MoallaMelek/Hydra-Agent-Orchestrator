import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Engine } from '@hydra/engine'
import { newId } from '@hydra/engine'
import type { CommandAck, Device, DeviceScope, EngineEvent } from '@hydra/protocol'
import {
  Channel, encodeOffer, fingerprint, fromHex, keyPairFromSecret, randomBytes, serverHandshake, toHex,
  type ClientHello, type Frame, type KeyPair
} from '@hydra/secure-channel'
import { send, serveStaticFile } from './server.js'
import { safePath, SECURITY_HEADERS } from './security.js'
import { lanAddresses, type LanAddress } from './addresses.js'

const PAIRING_TTL_MS = 5 * 60_000
const DEVICE_TTL_MS = 30 * 24 * 60 * 60_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const MAX_HANDSHAKES_PER_MINUTE = 20
const MAX_TRACKED_IPS = 2048
const MAX_OPEN_PAIRINGS = 10
const MAX_SESSIONS_PER_DEVICE = 3
const MAX_IN_FLIGHT = 8
/** A phone that stops reading is disconnected before its send buffer grows past this. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024
const SNAPSHOT_TASK_LIMIT = 200
/** Journal events replayed per request to a phone catching up after a disconnect. */
const REPLAY_LIMIT = 500
const FORWARDED: ReadonlySet<EngineEvent['type']> = new Set(['task.updated', 'task.deleted', 'task.log', 'run.updated', 'run.output', 'evidence.recorded', 'project.updated', 'project.removed'])

/** The phone UI is served from this origin; WebSockets go to the same origin. */
const REMOTE_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
}

interface Pairing { secret: Uint8Array; name: string; scopes: DeviceScope[]; expiresAt: number }
interface Session { ws: WebSocket; deviceId: string }

export interface RemoteHostOptions {
  engine: Engine
  staticDir?: string
  port: number
  /** 0.0.0.0 for LAN access; 127.0.0.1 in tests. */
  bind: string
  /** Host name or IP put into pairing links; defaults to the first LAN IPv4 address. */
  advertiseHost?: string
}


/** True when the device exists, is not revoked and has not expired, judged from the database now. */
function deviceActive(engine: Engine, deviceId: string): boolean {
  const found = engine.store.getDeviceKeys(deviceId)
  return Boolean(found && !found.device.revokedAt && Date.parse(found.device.expiresAt) > Date.now())
}

/**
 * Remote control over an end-to-end encrypted channel (docs/v2/REMOTE.md).
 * Off until the user pairs a device. No cloud service is involved.
 */
export class RemoteHost {
  private server: Server | null = null
  private port = 0
  private readonly identity: KeyPair
  private readonly pairings = new Map<string, Pairing>()
  private readonly sessions = new Set<Session>()
  /** Fixed-size handshake counter per IP: {window start, count}; never stores individual attempts. */
  private readonly attempts = new Map<string, { start: number; count: number }>()
  /** In-flight commands per device+id, so concurrent duplicates share one execution. */
  private readonly inFlight = new Map<string, Promise<CommandAck>>()

  constructor(private readonly options: RemoteHostOptions) {
    const stored = options.engine.store.getKv('remote.identity')
    this.identity = keyPairFromSecret(stored ? fromHex(stored) : randomBytes(32))
    if (!stored) options.engine.store.setKv('remote.identity', toHex(this.identity.secretKey))
    // Known before the first pairing so the UI can offer a choice of network.
    if (!options.advertiseHost) void lanAddresses().then((found) => { if (!this.addresses.length) this.addresses = found })
  }

  /** Addresses a phone could use, best first; refreshed when the host starts and at each pairing. */
  private addresses: LanAddress[] = []

  get running(): boolean { return this.server !== null }

  private advertised(): string {
    return this.options.advertiseHost ?? this.addresses[0]?.address ?? '127.0.0.1'
  }
  get engineFingerprint(): string { return fingerprint(this.identity.publicKey) }

  status() {
    return {
      relayUrl: this.server ? `http://${this.advertised()}:${this.port}` : null,
      connected: this.sessions.size > 0,
      addresses: this.options.advertiseHost ? [] : this.addresses.map((a) => ({ address: a.address, label: `${a.interface}${a.virtual ? ' (virtual adapter)' : ''}` }))
    }
  }

  async start(): Promise<void> {
    if (this.server) return
    const server = createServer((req, res) => {
      const path = safePath(req.url)
      if (path === null) return send(res, 400, { error: 'Bad request' })
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' })
      if (!this.options.staticDir) return send(res, 404, { error: 'UI not bundled' })
      serveStaticFile(res, this.options.staticDir, path === '/remote' ? '/index.html' : path, REMOTE_HEADERS)
    })
    server.on('clientError', (_error, socket) => socket.destroy())
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
    server.on('upgrade', (req, socket, head) => {
      socket.on('error', () => socket.destroy())
      const path = safePath(req.url)
      if (path !== '/remote/channel' || !this.allowAttempt(req)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws))
    })
    // Expired devices are disconnected even if they stay connected and idle.
    const sweep = setInterval(() => this.sweepSessions(), 60_000)
    sweep.unref()
    server.on('close', () => clearInterval(sweep))
    await new Promise<void>((done) => server.listen(this.options.port, this.options.bind, done))
    this.port = (server.address() as { port: number }).port
    if (!this.options.advertiseHost) this.addresses = await lanAddresses()
    this.server = server
    this.options.engine.store.setKv('remote.enabled', '1')
  }

  async stop(): Promise<void> {
    for (const session of this.sessions) session.ws.terminate()
    this.sessions.clear()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections() })
  }

  /** Creates a single-use pairing link (5 minutes). */
  async pairStart(name: string, scopes: DeviceScope[], requestedHost?: string): Promise<{ url: string; expiresAt: string; engineFingerprint: string; host: string }> {
    await this.start()
    if (!this.options.advertiseHost) this.addresses = await lanAddresses()
    // Only this computer's own addresses may be put into a pairing link.
    if (requestedHost && requestedHost !== this.options.advertiseHost && !this.addresses.some((a) => a.address === requestedHost)) {
      throw new Error('That address does not belong to this computer')
    }
    const host = requestedHost ?? this.advertised()
    for (const [key, pending] of this.pairings) if (pending.expiresAt < Date.now()) this.pairings.delete(key)
    if (this.pairings.size >= MAX_OPEN_PAIRINGS) throw new Error('Too many open pairing codes; wait for them to expire')
    const id = newId()
    const secret = randomBytes(32)
    const expiresAt = Date.now() + PAIRING_TTL_MS
    this.pairings.set(id, { secret, name, scopes: [...new Set<DeviceScope>(['view', ...scopes])], expiresAt })
    const offer = encodeOffer({ v: 1, e: toHex(this.identity.publicKey), i: id, s: toHex(secret) })
    return { url: `http://${host}:${this.port}/remote#p=${offer}`, expiresAt: new Date(expiresAt).toISOString(), engineFingerprint: this.engineFingerprint, host }
  }

  async revoke(deviceId: string): Promise<Device> {
    const found = this.options.engine.store.getDeviceKeys(deviceId)
    if (!found) throw new Error('Device not found')
    const device = { ...found.device, revokedAt: new Date().toISOString() }
    this.options.engine.store.putDevice(device, found.keys)
    for (const session of [...this.sessions]) if (session.deviceId === deviceId) session.ws.close(4403, 'revoked')
    return device
  }

  private sweepSessions(): void {
    for (const session of [...this.sessions]) {
      if (!deviceActive(this.options.engine, session.deviceId)) session.ws.close(4403, 'expired or revoked')
    }
  }

  private allowAttempt(req: IncomingMessage): boolean {
    const ip = req.socket.remoteAddress ?? 'unknown'
    const now = Date.now()
    let entry = this.attempts.get(ip)
    if (!entry || now - entry.start >= 60_000) {
      if (!entry && this.attempts.size >= MAX_TRACKED_IPS) {
        for (const [key, value] of this.attempts) if (now - value.start >= 60_000) this.attempts.delete(key)
        if (this.attempts.size >= MAX_TRACKED_IPS) return false // under attack from many addresses: refuse new ones
      }
      entry = { start: now, count: 0 }
      this.attempts.set(ip, entry)
    }
    if (entry.count >= MAX_HANDSHAKES_PER_MINUTE) return false
    entry.count++
    return true
  }

  /** Test hook: number of tracked addresses (must stay bounded under flooding). */
  get trackedAddresses(): number { return this.attempts.size }

  private accept(ws: WebSocket): void {
    const store = this.options.engine.store
    const timer = setTimeout(() => ws.close(4408, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS)
    let channel: Channel | null = null
    let deviceId: string | null = null
    let scopes: DeviceScope[] = []
    let pairing: { id: string; value: Pairing } | null = null
    let devicePub = ''
    let unsubscribe: (() => void) | null = null
    let tokens = 30
    let refilledAt = Date.now()
    let inFlight = 0

    const sendFrame = (message: unknown) => {
      if (!channel || ws.readyState !== ws.OPEN) return
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) { ws.terminate(); return } // slow consumer
      ws.send(JSON.stringify(channel.seal(message)))
    }

    ws.on('message', (raw) => {
      let frame: unknown
      try { frame = JSON.parse(String(raw)) } catch { return ws.close(4400, 'bad frame') }
      if (!frame || typeof frame !== 'object') return ws.close(4400, 'bad frame')
      try {
        if (!channel) {
          const hello = frame as ClientHello
          devicePub = String(hello.d)
          if (hello.p) {
            const value = this.pairings.get(String(hello.p))
            if (!value || value.expiresAt < Date.now()) return ws.close(4401, 'pairing expired or unknown')
            pairing = { id: String(hello.p), value }
          } else {
            const known = store.findDeviceByKey(devicePub)
            if (!known || !deviceActive(this.options.engine, known.device.id)) return ws.close(4401, 'unknown, revoked or expired device')
          }
          const { reply, keys } = serverHandshake(this.identity, hello, pairing?.value.secret ?? null)
          channel = new Channel(keys)
          ws.send(JSON.stringify(reply))
          return
        }
        const message = channel.open<Record<string, unknown>>(frame as Frame) // throws on wrong keys, tampering or replay
        if (!deviceId) {
          clearTimeout(timer)
          if (message.type !== 'auth') return ws.close(4401, 'auth expected')
          const device = this.authenticate(devicePub, pairing, typeof message.name === 'string' ? message.name : null)
          if (!device) return ws.close(4401, 'unknown, revoked or expired device')
          deviceId = device.id
          scopes = device.scopes
          const mine = [...this.sessions].filter((s) => s.deviceId === device.id)
          if (mine.length >= MAX_SESSIONS_PER_DEVICE) mine[0]!.ws.close(4409, 'replaced by a newer session')
          this.sessions.add({ ws, deviceId })
          unsubscribe = this.options.engine.subscribe((envelope) => { if (FORWARDED.has(envelope.event.type)) sendFrame({ event: envelope }) })
          sendFrame({ type: 'welcome', deviceId: device.id, name: device.name, scopes: device.scopes, expiresAt: device.expiresAt })
          return
        }
        // Revocation or expiry since the session began ends it before any request runs.
        if (!deviceActive(this.options.engine, deviceId)) return ws.close(4403, 'expired or revoked')
        const id = typeof message.id === 'string' ? message.id : null
        const now = Date.now()
        tokens = Math.min(30, tokens + ((now - refilledAt) / 1000) * 10)
        refilledAt = now
        if (tokens < 1 || inFlight >= MAX_IN_FLIGHT) return sendFrame({ ack: id, ok: false, error: { code: 'unavailable', message: 'Too many requests; slow down' } })
        tokens -= 1
        inFlight++
        void this.handle(message, deviceId, scopes).then(sendFrame).finally(() => { inFlight-- })
      } catch {
        ws.close(4401, 'channel error')
      }
    })
    ws.on('close', () => {
      clearTimeout(timer)
      unsubscribe?.()
      for (const session of [...this.sessions]) if (session.ws === ws) this.sessions.delete(session)
    })
    ws.on('error', () => ws.terminate())
  }

  /**
   * First authenticated frame: registers a paired device or refreshes a known one.
   * State is re-read here, so a revocation during the handshake still wins.
   */
  private authenticate(devicePub: string, pairing: { id: string; value: Pairing } | null, requestedName: string | null): Device | null {
    const store = this.options.engine.store
    const now = new Date()
    if (pairing) {
      // Single use, claimed atomically: if two phones raced the same link, only the first registers.
      if (!this.pairings.delete(pairing.id) || pairing.value.expiresAt < now.getTime()) return null
      const device: Device = {
        id: newId(), name: (requestedName || pairing.value.name).slice(0, 80), scopes: pairing.value.scopes,
        pairedAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt: new Date(now.getTime() + DEVICE_TTL_MS).toISOString(), revokedAt: null
      }
      store.putDevice(device, { pub: devicePub })
      store.audit(`device:${device.id}`, 'device.paired', { name: device.name, scopes: device.scopes })
      return device
    }
    const known = store.findDeviceByKey(devicePub)
    if (!known || !deviceActive(this.options.engine, known.device.id)) return null
    const device = { ...known.device, lastSeenAt: now.toISOString() }
    store.putDevice(device, known.keys)
    return device
  }

  private async handle(message: Record<string, unknown>, deviceId: string, scopes: DeviceScope[]): Promise<unknown> {
    const id = typeof message.id === 'string' ? message.id.slice(0, 64) : null
    if (!id) return { ack: null, ok: false, error: { code: 'invalid', message: 'Missing message id' } }
    const engine = this.options.engine
    try {
      if (message.kind === 'command') {
        const key = `${deviceId}:${id}`
        const previous = engine.store.recallRemoteCommand(deviceId, id)
        if (previous) return { ack: id, ...(previous as CommandAck) }
        let running = this.inFlight.get(key)
        if (!running) {
          running = engine.execute(message.command, { kind: 'remote', deviceId, scopes }).then((ack) => {
            // Only successful commands are remembered (bounded size); failures are safe to retry.
            if (ack.ok) engine.store.rememberRemoteCommand(deviceId, id, JSON.stringify(ack).length > 16_384 ? { ok: true, result: null } : ack)
            return ack
          }).finally(() => this.inFlight.delete(key))
          this.inFlight.set(key, running)
        }
        return { ack: id, ...(await running) }
      }
      if (message.kind === 'query') {
        const taskId = typeof message.taskId === 'string' ? message.taskId : ''
        if (message.query === 'snapshot') {
          const snapshot = engine.snapshot()
          return { ack: id, ok: true, result: { ...snapshot, devices: [], tasks: snapshot.tasks.slice(0, SNAPSHOT_TASK_LIMIT) } }
        }
        if (message.query === 'events') {
          // Catch-up after a disconnect: journal events after the phone's cursor, oldest first.
          const after = typeof message.after === 'number' && message.after >= 0 ? Math.floor(message.after) : engine.store.lastSeq
          const batch = engine.store.eventsAfter(after, REPLAY_LIMIT)
          const lastSeq = batch.at(-1)?.seq ?? after
          return { ack: id, ok: true, result: { events: batch.filter((e) => FORWARDED.has(e.event.type)), lastSeq, complete: batch.length < REPLAY_LIMIT } }
        }
        if (message.query === 'task') return { ack: id, ok: true, result: engine.taskDetail(taskId) }
        if (message.query === 'diff') return { ack: id, ok: true, result: await engine.taskDiff(taskId) }
      }
      return { ack: id, ok: false, error: { code: 'invalid', message: 'Unknown request' } }
    } catch (error) {
      return { ack: id, ok: false, error: { code: 'internal', message: (error as Error).message } }
    }
  }
}
