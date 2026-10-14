import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { AdapterRegistry, Engine } from '@hydra/engine'
import { Channel, clientHandshake, decodeOffer, fromHex, generateKeyPair, randomBytes, type KeyPair, type ServerHello } from '@hydra/secure-channel'
import { ScriptedAdapter } from '../../../packages/engine/src/agents/scripted.js'
import { cleanup, makeRepo, tempDir } from '../../../packages/engine/src/testing/fixtures.js'
import { RemoteHost } from './remote.js'

const opened: Array<{ engine: Engine; remote: RemoteHost }> = []
const dirs: string[] = []
afterEach(async () => {
  for (const { engine, remote } of opened.splice(0)) { await remote.stop(); await engine.close() }
  cleanup(...dirs.splice(0))
})

async function boot() {
  const dataDir = tempDir('hydra-remote-')
  dirs.push(dataDir)
  const engine = await Engine.open({ dataDir, skipProbe: true, registry: new AdapterRegistry([new ScriptedAdapter(() => ({ structured: { answer: 'remote answer', keyFindings: [], filesReferenced: [] } }))]) })
  const remote = new RemoteHost({ engine, port: 0, bind: '127.0.0.1', advertiseHost: '127.0.0.1' })
  engine.setHooks({ pairStart: (n, s) => remote.pairStart(n, s), revokeDevice: (id) => remote.revoke(id) })
  opened.push({ engine, remote })
  return { engine, remote }
}

/** A minimal phone: performs the handshake and exchanges encrypted messages. */
class Phone {
  private ws!: WebSocket
  private channel!: Channel
  readonly inbox: Array<Record<string, unknown>> = []
  closeCode: number | null = null
  constructor(readonly key: KeyPair = generateKeyPair()) {}

  connect(url: string, enginePub: string, pairing: { id: string; secret: Uint8Array } | null, name = 'Test phone', beforeAuth?: () => Promise<unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const hs = clientHandshake(this.key, fromHex(enginePub), pairing?.id ?? null)
      this.ws = new WebSocket(url.replace(/^http/, 'ws').replace(/\/remote.*$/, '/remote/channel'))
      this.ws.on('open', () => this.ws.send(JSON.stringify(hs.hello)))
      this.ws.on('close', (code) => { this.closeCode = code; reject(new Error(`closed ${code}`)) })
      this.ws.on('message', (raw) => {
        const data = JSON.parse(String(raw)) as Record<string, unknown>
        if (!this.channel) {
          this.channel = new Channel(hs.finish(data as unknown as ServerHello, pairing?.secret ?? null))
          const auth = () => this.ws.send(JSON.stringify(this.channel.seal({ type: 'auth', name })))
          if (beforeAuth) void beforeAuth().then(auth)
          else auth()
          return
        }
        const message = this.channel.open<Record<string, unknown>>(data as never)
        if (message.type === 'welcome') resolve(message)
        else this.inbox.push(message)
      })
    })
  }

  send(body: Record<string, unknown>): void { this.ws.send(JSON.stringify(this.channel.seal(body))) }

  acks(id: string, count: number): Promise<Array<Record<string, unknown>>> {
    return new Promise((resolve) => {
      const check = () => {
        const found = this.inbox.filter((m) => m.ack === id)
        if (found.length >= count) resolve(found)
        else setTimeout(check, 20)
      }
      check()
    })
  }

  request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = String(body.id)
    this.ws.send(JSON.stringify(this.channel.seal(body)))
    return new Promise((resolve) => {
      const check = () => {
        const found = this.inbox.find((m) => m.ack === id)
        if (found) { this.inbox.splice(this.inbox.indexOf(found), 1); resolve(found) } else setTimeout(check, 20)
      }
      check()
    })
  }

  close(): void { this.ws.close() }

  waitClosed(): Promise<number> {
    return new Promise((resolve) => {
      if (this.closeCode !== null) return resolve(this.closeCode)
      this.ws.on('close', (code) => resolve(code))
    })
  }
}

function parse(url: string) {
  const offer = decodeOffer(url.split('#p=')[1]!)
  return { enginePub: offer.e, pairing: { id: offer.i, secret: fromHex(offer.s) } }
}

describe('remote control over the encrypted channel', () => {
  it('pairs once, reconnects as a known device, runs scoped commands and receives events', async () => {
    const { engine, remote } = await boot()
    const link = await remote.pairStart('Pixel', ['control'])
    const { enginePub, pairing } = parse(link.url)

    const phone = new Phone()
    const welcome = await phone.connect(link.url, enginePub, pairing)
    expect(welcome).toMatchObject({ type: 'welcome', name: 'Test phone', scopes: ['view', 'control'] })
    expect(engine.store.listDevices()).toHaveLength(1)

    // The pairing link is single use.
    await expect(new Phone().connect(link.url, enginePub, pairing)).rejects.toThrow(/closed 4401/)

    // Known device reconnects without a pairing secret.
    const again = new Phone(phone.key)
    await again.connect(link.url, enginePub, null)

    const repo = makeRepo({ 'a.txt': 'a' })
    dirs.push(repo)
    // Desktop-only commands are refused remotely; control commands work.
    const addProject = await again.request({ id: 'c1', kind: 'command', command: { type: 'project.add', root: repo } })
    expect(addProject).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    const project = await engine.execute({ type: 'project.add', root: repo })
    const projectId = (project as { result: { id: string } }).result.id
    const create = await again.request({ id: 'c2', kind: 'command', command: { type: 'task.create', projectId, prompt: 'What is in a.txt?', intent: 'analyze', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } } })
    expect(create).toMatchObject({ ok: true })
    // Idempotent: the same id returns the stored ack, no second task.
    const replay = await again.request({ id: 'c2', kind: 'command', command: { type: 'task.create', projectId, prompt: 'duplicate', intent: 'analyze', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } } })
    expect(replay).toMatchObject({ ok: true })
    await new Promise((r) => setTimeout(r, 300))
    expect(engine.store.listTasks()).toHaveLength(1)
    expect(again.inbox.some((m) => (m.event as { event?: { type?: string } } | undefined)?.event?.type === 'task.updated')).toBe(true)

    // Approve-level commands are refused without the approve scope.
    const taskId = engine.store.listTasks()[0]!.id
    const decide = await again.request({ id: 'c3', kind: 'command', command: { type: 'task.decide', taskId, decision: 'reject' } })
    expect(decide).toMatchObject({ ok: false, error: { code: 'forbidden' } })

    const snapshot = await again.request({ id: 'q1', kind: 'query', query: 'snapshot' })
    expect(snapshot).toMatchObject({ ok: true, result: { devices: [] } })

    // Revocation closes the live session and blocks reconnects.
    const deviceId = String(welcome.deviceId)
    const closed = again.waitClosed()
    await engine.execute({ type: 'device.revoke', deviceId })
    expect(await closed).toBe(4403)
    await expect(new Phone(phone.key).connect(link.url, enginePub, null)).rejects.toThrow(/closed 4401/)
  })

  it('registers exactly one device when two phones race the same pairing link', async () => {
    const { engine, remote } = await boot()
    const link = await remote.pairStart('Phone', ['control'])
    const { enginePub, pairing } = parse(link.url)
    const results = await Promise.allSettled([
      new Phone().connect(link.url, enginePub, pairing),
      new Phone().connect(link.url, enginePub, pairing)
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(engine.store.listDevices()).toHaveLength(1)
  })

  it('refuses a wrong pairing secret, unknown devices and an impostor engine key', async () => {
    const { remote } = await boot()
    const link = await remote.pairStart('Phone', [])
    const { enginePub, pairing } = parse(link.url)
    await expect(new Phone().connect(link.url, enginePub, { id: pairing.id, secret: randomBytes(32) })).rejects.toThrow(/closed 4401/)
    await expect(new Phone().connect(link.url, enginePub, null)).rejects.toThrow(/closed 4401/)
    const impostor = generateKeyPair()
    await expect(new Phone().connect(link.url, Buffer.from(impostor.publicKey).toString('hex'), pairing)).rejects.toThrow(/closed 4401/)
    // A failed attempt does not consume the pairing: the real phone can still pair.
    await expect(new Phone().connect(link.url, enginePub, pairing)).resolves.toMatchObject({ type: 'welcome' })
  })})

// Regression tests for the independent security review (docs/v2/SECURITY_AUDIT.md, findings R1, R4–R7).
describe('remote control hardening', () => {
  async function pairedPhone(scopes: Array<'control' | 'approve'> = ['control']) {
    const booted = await boot()
    const link = await booted.remote.pairStart('Phone', scopes)
    const { enginePub, pairing } = parse(link.url)
    const phone = new Phone()
    const welcome = await phone.connect(link.url, enginePub, pairing)
    return { ...booted, link, enginePub, phone, deviceId: String(welcome.deviceId) }
  }

  it('refuses a device revoked between the handshake and authentication', async () => {
    const { engine, link, enginePub, phone, deviceId } = await pairedPhone()
    const late = new Phone(phone.key)
    await expect(late.connect(link.url, enginePub, null, 'Phone', () => engine.execute({ type: 'device.revoke', deviceId }))).rejects.toThrow(/closed 4401/)
  })

  it('ends a live session as soon as the device expires', async () => {
    const { engine, phone, deviceId } = await pairedPhone()
    const found = engine.store.getDeviceKeys(deviceId)!
    engine.store.putDevice({ ...found.device, expiresAt: new Date(Date.now() - 1000).toISOString() }, found.keys)
    const closed = phone.waitClosed()
    phone.send({ id: 'q1', kind: 'query', query: 'snapshot' })
    expect(await closed).toBe(4403)
  })

  it('runs a command once when the same id arrives twice concurrently', async () => {
    const { engine, phone } = await pairedPhone()
    const repo = makeRepo({ 'a.txt': 'a' })
    dirs.push(repo)
    const project = await engine.execute({ type: 'project.add', root: repo })
    const projectId = (project as { result: { id: string } }).result.id
    const command = { type: 'task.create', projectId, prompt: 'What is in a.txt?', intent: 'analyze', mode: 'safe', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' } }
    phone.send({ id: 'dup', kind: 'command', command })
    phone.send({ id: 'dup', kind: 'command', command })
    const acks = await phone.acks('dup', 2)
    expect(acks.every((a) => a.ok === true)).toBe(true)
    expect(engine.store.listTasks()).toHaveLength(1)
  })

  it('stores acknowledgements only for successful commands, within a bounded size', async () => {
    const { engine, phone, deviceId } = await pairedPhone()
    const refused = await phone.request({ id: 'f1', kind: 'command', command: { type: 'project.add', root: 'C:/nowhere' } })
    expect(refused).toMatchObject({ ok: false })
    expect(engine.store.countRemoteCommands(deviceId)).toBe(0)
    for (let i = 0; i < 1010; i++) engine.store.rememberRemoteCommand(deviceId, `c${i}`, { ok: true, result: null })
    expect(engine.store.countRemoteCommands(deviceId)).toBe(1000)
    expect(engine.store.recallRemoteCommand(deviceId, 'c1009')).toBeTruthy()
    expect(engine.store.recallRemoteCommand(deviceId, 'c0')).toBeUndefined()
  })

  it('throttles a flooding phone instead of queueing unbounded work', async () => {
    const { phone } = await pairedPhone()
    for (let i = 0; i < 60; i++) phone.send({ id: `s${i}`, kind: 'query', query: 'snapshot' })
    const all = await Promise.all(Array.from({ length: 60 }, (_, i) => phone.acks(`s${i}`, 1).then((a) => a[0]!)))
    expect(all.filter((a) => a.ok === false && (a.error as { code: string }).code === 'unavailable').length).toBeGreaterThan(0)
    expect(all.filter((a) => a.ok === true).length).toBeGreaterThan(0)
  })

  it('keeps at most three sessions per device, closing the oldest', async () => {
    const { link, enginePub, phone } = await pairedPhone()
    const oldest = phone.waitClosed()
    for (let i = 0; i < 3; i++) await new Phone(phone.key).connect(link.url, enginePub, null)
    expect(await oldest).toBe(4409)
  })

  it('lets a reconnecting phone replay the activity it missed, without other event types', async () => {
    const { engine, link, enginePub, phone } = await pairedPhone()
    const before = engine.store.lastSeq
    phone.close()
    // While the phone is away: activity it may see, and a device event it may not.
    for (let i = 0; i < 3; i++) engine.store.publish({ type: 'task.log', taskId: 't-missed', level: 'info', message: `missed ${i}` })
    engine.store.publish({ type: 'device.updated', device: engine.store.listDevices()[0]! })
    const back = new Phone(phone.key)
    await back.connect(link.url, enginePub, null)
    const reply = await back.request({ id: 'r1', kind: 'query', query: 'events', after: before })
    const result = reply.result as { events: Array<{ seq: number; event: { type: string; message?: string } }>; lastSeq: number; complete: boolean }
    expect(reply.ok).toBe(true)
    expect(result.events.map((e) => e.event.message)).toEqual(['missed 0', 'missed 1', 'missed 2'])
    expect(result.events.every((e) => e.event.type === 'task.log')).toBe(true)
    expect(result.lastSeq).toBe(engine.store.lastSeq)
    expect(result.complete).toBe(true)
  })

  it('keeps the handshake limiter bounded under many source addresses', async () => {
    const { remote } = await boot()
    const allow = (remote as unknown as { allowAttempt(req: unknown): boolean }).allowAttempt.bind(remote)
    for (let i = 0; i < 5000; i++) allow({ socket: { remoteAddress: `10.0.${i >> 8}.${i & 255}` } })
    expect(remote.trackedAddresses).toBeLessThanOrEqual(2048)
    const one = { socket: { remoteAddress: '192.0.2.1' } }
    const results = Array.from({ length: 1000 }, () => allow(one))
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(20)
  })
})

describe('phone access is explicit and time-limited', () => {
  async function bootAuto() {
    const dataDir = tempDir('hydra-remote-access-')
    dirs.push(dataDir)
    const engine = await Engine.open({ dataDir, skipProbe: true, registry: new AdapterRegistry([new ScriptedAdapter(() => ({ text: 'x' }))]) })
    // 'auto' binds to the chosen address only; 127.0.0.1 stands in for the Wi-Fi address here.
    const remote = new RemoteHost({ engine, port: 0, bind: 'auto', advertiseHost: '127.0.0.1' })
    engine.setHooks({ pairStart: (n, s, h) => remote.pairStart(n, s, h), revokeDevice: (id) => remote.revoke(id), remoteStatus: () => remote.status(), remoteEnable: (m, h) => remote.enable(m * 60_000, h), remoteDisable: () => remote.stop() })
    opened.push({ engine, remote })
    return { engine, remote }
  }

  it('is off until turned on, and listens on the chosen address only', async () => {
    const { remote } = await bootAuto()
    expect(remote.running).toBe(false)
    expect(remote.status()).toMatchObject({ enabled: false, host: null })
    await remote.enable(60_000)
    const address = (remote as unknown as { server: { address(): { address: string } } }).server.address()
    expect(address.address).toBe('127.0.0.1')
    expect(remote.status()).toMatchObject({ enabled: true, host: '127.0.0.1' })
    expect(remote.status().until).not.toBeNull()
  })

  it('switches itself off when the time is up', async () => {
    const { remote } = await bootAuto()
    await remote.enable(150)
    expect(remote.running).toBe(true)
    await new Promise((r) => setTimeout(r, 400))
    expect(remote.running).toBe(false)
    expect(remote.status().enabled).toBe(false)
  })

  it('refuses an address that is not this computer\'s', async () => {
    const { remote } = await bootAuto()
    await expect(remote.enable(60_000, '203.0.113.9')).rejects.toThrow(/does not belong/)
    expect(remote.running).toBe(false)
  })

  it('a paired phone cannot turn phone access on or off', async () => {
    const { engine } = await bootAuto()
    const actor = { kind: 'remote' as const, deviceId: 'd1', scopes: ['view', 'control', 'approve'] as const }
    expect(await engine.execute({ type: 'remote.enable', minutes: 60 }, actor)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(await engine.execute({ type: 'remote.disable' }, actor)).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })

  it('the desktop turns it on and off through commands, and both are audited', async () => {
    const { engine, remote } = await bootAuto()
    expect((await engine.execute({ type: 'remote.enable', minutes: 60 })).ok).toBe(true)
    expect(remote.running).toBe(true)
    expect((await engine.execute({ type: 'remote.disable' })).ok).toBe(true)
    expect(remote.running).toBe(false)
    expect(engine.store.listAudit(10).map((a) => a.action)).toEqual(expect.arrayContaining(['remote.enable', 'remote.disable']))
  })
})
