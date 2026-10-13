import { describe, expect, it } from 'vitest'
import { Channel, clientHandshake, decodeOffer, encodeOffer, generateKeyPair, randomBytes, serverHandshake, toHex } from './index.js'

function connect(opts: { clientSecret?: Uint8Array | null; serverSecret?: Uint8Array | null; enginePubForClient?: Uint8Array } = {}) {
  const engine = generateKeyPair()
  const device = generateKeyPair()
  const client = clientHandshake(device, opts.enginePubForClient ?? engine.publicKey, opts.clientSecret ? 'pair-id-1234' : null)
  const server = serverHandshake(engine, client.hello, opts.serverSecret ?? null)
  const clientKeys = client.finish(server.reply, opts.clientSecret ?? null)
  return { c: new Channel(clientKeys), s: new Channel(server.keys) }
}

describe('secure channel', () => {
  it('round-trips messages in both directions', () => {
    const { c, s } = connect()
    expect(s.open(c.seal({ hello: 'engine' }))).toEqual({ hello: 'engine' })
    expect(c.open(s.seal({ ack: 1 }))).toEqual({ ack: 1 })
  })

  it('rejects replayed and reordered frames', () => {
    const { c, s } = connect()
    const a = c.seal({ n: 1 })
    const b = c.seal({ n: 2 })
    expect(s.open(b)).toEqual({ n: 2 })
    expect(() => s.open(a)).toThrow(/Replayed/)
    expect(() => s.open(b)).toThrow(/Replayed/)
  })

  it('rejects tampered ciphertext', () => {
    const { c, s } = connect()
    const frame = c.seal({ cmd: 'task.cancel' })
    const bytes = frame.c.split('')
    bytes[10] = bytes[10] === 'A' ? 'B' : 'A'
    expect(() => s.open({ ...frame, c: bytes.join('') })).toThrow()
  })

  it('a wrong pairing secret yields unusable keys', () => {
    const secret = randomBytes(32)
    const { c, s } = connect({ clientSecret: randomBytes(32), serverSecret: secret })
    expect(() => s.open(c.seal({ name: 'phone' }))).toThrow()
    const ok = connect({ clientSecret: secret, serverSecret: secret })
    expect(ok.s.open(ok.c.seal({ name: 'phone' }))).toEqual({ name: 'phone' })
  })

  it('a client pinned to the wrong engine key cannot talk to the real engine', () => {
    const { c, s } = connect({ enginePubForClient: generateKeyPair().publicKey })
    expect(() => s.open(c.seal({ x: 1 }))).toThrow()
  })

  it('validates pairing offers', () => {
    const offer = { v: 1, e: toHex(generateKeyPair().publicKey), i: 'pairing-abcdef12', s: toHex(randomBytes(32)) }
    expect(decodeOffer(encodeOffer(offer))).toEqual(offer)
    expect(() => decodeOffer(encodeOffer({ ...offer, e: 'nothex' }))).toThrow(/pairing link/)
  })
})
