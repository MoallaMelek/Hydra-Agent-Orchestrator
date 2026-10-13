import { createServer, type IncomingMessage, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Engine } from '@hydra/engine'
import { newId } from '@hydra/engine'
import type { CommandAck, Device, DeviceScope, EngineEvent } from '@hydra/protocol'
import {
  Channel, encodeOffer, fingerprint, fromHex, keyPairFromSecret, randomBytes, serverHandshake, toHex,
  type ClientHello, type Frame, type KeyPair
} from '@hydra/secure-channel'
import { send, serveStaticFile } from './server.js'
import { SECURITY_HEADERS } from './security.js'

const PAIRING_TTL_MS = 5 * 60_000
const DEVICE_TTL_MS = 30 * 24 * 60 * 60_000
const HANDSHAKE_TIMEOUT_MS = 10_000
const MAX_HANDSHAKES_PER_MINUTE = 20
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

export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address
  }
  return '127.0.0.1'
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
  private readonly attempts = new Map<string, number[]>()

  constructor(private readonly options: RemoteHostOptions) {
    const stored = options.engine.store.getKv('remote.identity')
    this.identity = keyPairFromSecret(stored ? fromHex(stored) : randomBytes(32))
    if (!stored) options.engine.store.setKv('remote.identity', toHex(this.identity.secretKey))
  }

  get running(): boolean { return this.server !== null }
  get engineFingerprint(): string { return fingerprint(this.identity.publicKey) }

  status() {
    return { relayUrl: this.server ? `http://${this.options.advertiseHost ?? lanAddress()}:${this.port}` : null, connected: this.sessions.size > 0 }
  }

  async start(): Promise<void> {
    if (this.server) return
    const server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' })
      if (!this.options.staticDir) return send(res, 404, { error: 'UI not bundled' })
      serveStaticFile(res, this.options.staticDir, path === '/remote' ? '/index.html' : path, REMOTE_HEADERS)
    })
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 })
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      if (path !== '/remote/channel' || !this.allowAttempt(req)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws))
    })
    await new Promise<void>((done) => server.listen(this.options.port, this.options.bind, done))
    this.port = (server.address() as { port: number }).port
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
  async pairStart(name: string, scopes: DeviceScope[]): Promise<{ url: string; expiresAt: string; engineFingerprint: string }> {
    await this.start()
    const id = newId()
    const secret = randomBytes(32)
    const expiresAt = Date.now() + PAIRING_TTL_MS
    this.pairings.set(id, { secret, name, scopes: [...new Set<DeviceScope>(['view', ...scopes])], expiresAt })
    const offer = encodeOffer({ v: 1, e: toHex(this.identity.publicKey), i: id, s: toHex(secret) })
    const host = this.options.advertiseHost ?? lanAddress()
    return { url: `http://${host}:${this.port}/remote#p=${offer}`, expiresAt: new Date(expiresAt).toISOString(), engineFingerprint: this.engineFingerprint }
  }

  async revoke(deviceId: string): Promise<Device> {
    const found = this.options.engine.store.getDeviceKeys(deviceId)
    if (!found) throw new Error('Device not found')
    const device = { ...found.device, revokedAt: new Date().toISOString() }
    this.options.engine.store.putDevice(device, found.keys)
    for (const session of [...this.sessions]) if (session.deviceId === deviceId) session.ws.close(4403, 'revoked')
    return device
  }

  private allowAttempt(req: IncomingMessage): boolean {
    const ip = req.socket.remoteAddress ?? 'unknown'
    const now = Date.now()
    const recent = (this.attempts.get(ip) ?? []).filter((t) => now - t < 60_000)
    recent.push(now)
    this.attempts.set(ip, recent)
    return recent.length <= MAX_HANDSHAKES_PER_MINUTE
  }

  private accept(ws: WebSocket): void {
    const store = this.options.engine.store
    const timer = setTimeout(() => ws.close(4408, 'handshake timeout'), HANDSHAKE_TIMEOUT_MS)
    let channel: Channel | null = null
    let deviceId: string | null = null
    let scopes: DeviceScope[] = []
    let pairing: { id: string; value: Pairing } | null = null
    let devicePub = ''
    let unsubscribe: (() => void) | null = null

    const sendFrame = (message: unknown) => { if (channel && ws.readyState === ws.OPEN) ws.send(JSON.stringify(channel.seal(message))) }

    ws.on('message', (raw) => {
      let frame: unknown
      try { frame = JSON.parse(String(raw)) } catch { return ws.close(4400, 'bad frame') }
      try {
        if (!channel) {
          const hello = frame as ClientHello
          devicePub = String(hello.d)
          if (hello.p) {
            const value = this.pairings.get(hello.p)
            if (!value || value.expiresAt < Date.now()) return ws.close(4401, 'pairing expired or unknown')
            pairing = { id: hello.p, value }
          } else {
            const known = store.findDeviceByKey(devicePub)
            if (!known || known.device.revokedAt || Date.parse(known.device.expiresAt) < Date.now()) return ws.close(4401, 'unknown, revoked or expired device')
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
          deviceId = device.id
          scopes = device.scopes
          this.sessions.add({ ws, deviceId })
          unsubscribe = this.options.engine.subscribe((envelope) => { if (FORWARDED.has(envelope.event.type)) sendFrame({ event: envelope }) })
          sendFrame({ type: 'welcome', deviceId: device.id, name: device.name, scopes: device.scopes, expiresAt: device.expiresAt })
          return
        }
        void this.handle(message, deviceId, scopes).then(sendFrame)
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

  /** First authenticated frame: registers a paired device or refreshes a known one. */
  private authenticate(devicePub: string, pairing: { id: string; value: Pairing } | null, requestedName: string | null): Device {
    const store = this.options.engine.store
    const now = new Date()
    if (pairing) {
      this.pairings.delete(pairing.id) // single use
      const device: Device = {
        id: newId(), name: (requestedName || pairing.value.name).slice(0, 80), scopes: pairing.value.scopes,
        pairedAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt: new Date(now.getTime() + DEVICE_TTL_MS).toISOString(), revokedAt: null
      }
      store.putDevice(device, { pub: devicePub })
      store.audit(`device:${device.id}`, 'device.paired', { name: device.name, scopes: device.scopes })
      return device
    }
    const known = store.findDeviceByKey(devicePub)!
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
        const previous = engine.store.recallRemoteCommand(deviceId, id)
        if (previous) return { ack: id, ...(previous as CommandAck) }
        const ack = await engine.execute(message.command, { kind: 'remote', deviceId, scopes })
        engine.store.rememberRemoteCommand(deviceId, id, ack)
        return { ack: id, ...ack }
      }
      if (message.kind === 'query') {
        const taskId = typeof message.taskId === 'string' ? message.taskId : ''
        if (message.query === 'snapshot') return { ack: id, ok: true, result: { ...engine.snapshot(), devices: [] } }
        if (message.query === 'task') return { ack: id, ok: true, result: engine.taskDetail(taskId) }
        if (message.query === 'diff') return { ack: id, ok: true, result: await engine.taskDiff(taskId) }
      }
      return { ack: id, ok: false, error: { code: 'invalid', message: 'Unknown request' } }
    } catch (error) {
      return { ack: id, ok: false, error: { code: 'internal', message: (error as Error).message } }
    }
  }
}
