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

  connect(url: string, enginePub: string, pairing: { id: string; secret: Uint8Array } | null, name = 'Test phone'): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const hs = clientHandshake(this.key, fromHex(enginePub), pairing?.id ?? null)
      this.ws = new WebSocket(url.replace(/^http/, 'ws').replace(/\/remote.*$/, '/remote/channel'))
      this.ws.on('open', () => this.ws.send(JSON.stringify(hs.hello)))
      this.ws.on('close', (code) => { this.closeCode = code; reject(new Error(`closed ${code}`)) })
      this.ws.on('message', (raw) => {
        const data = JSON.parse(String(raw)) as Record<string, unknown>
        if (!this.channel) {
          this.channel = new Channel(hs.finish(data as unknown as ServerHello, pairing?.secret ?? null))
          this.ws.send(JSON.stringify(this.channel.seal({ type: 'auth', name })))
          return
        }
        const message = this.channel.open<Record<string, unknown>>(data as never)
        if (message.type === 'welcome') resolve(message)
        else this.inbox.push(message)
      })
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
  })
})
