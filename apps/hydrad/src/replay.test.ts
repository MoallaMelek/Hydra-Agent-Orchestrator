import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import type { Engine } from '@hydra/engine'
import type { EventEnvelope } from '@hydra/protocol'
import { attachStream } from './server.js'

class Socket extends EventEmitter {
  readyState = 1
  OPEN = 1
  bufferedAmount = 0
  frames: string[] = []
  code = 0
  send(frame: string) { this.frames.push(frame) }
  ping() {}
  close(code: number) { this.code = code; this.readyState = 3; this.emit('close') }
  terminate() { this.close(1006) }
}
const TOKEN = 'fixture-token'
function setup(total: number) {
  const socket = new Socket()
  const rows: EventEnvelope[] = Array.from({ length: total }, (_, i) => ({ seq: i + 1, at: new Date().toISOString(), event: { type: 'project.removed', projectId: 'fixture' } }))
  const sizes: number[] = []
  const engine = { store: { lastSeq: total, eventsAfter: (after: number, limit: number) => { sizes.push(limit); return rows.filter(e => e.seq > after).slice(0, limit) } }, subscribe: () => () => {} } as unknown as Engine
  attachStream(socket as unknown as WebSocket, engine, TOKEN)
  return { socket, sizes }
}
it('yields every 64 events and replays each durable event in order before ready', async () => {
  const { socket, sizes } = setup(130)
  try {
    socket.emit('message', JSON.stringify({ type: 'auth', token: TOKEN, after: 0 }))
    expect(socket.frames).toHaveLength(64)
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve))
    expect(socket.frames.map(f => JSON.parse(f)).filter(f => f.type === 'event').map(f => f.envelope.seq)).toEqual(Array.from({ length: 130 }, (_, i) => i + 1))
    expect(JSON.parse(socket.frames.at(-1)!)).toMatchObject({ type: 'ready', lastSeq: 130 })
    expect(sizes.every(size => size === 64)).toBe(true)
  } finally { socket.close(1000) }
})
it('disconnects a slow consumer before adding to an oversized outbound queue', () => {
  const { socket } = setup(1)
  socket.bufferedAmount = 2 * 1024 * 1024
  socket.emit('message', JSON.stringify({ type: 'auth', token: TOKEN, after: 0 }))
  expect(socket.code).toBe(4413)
  expect(socket.frames).toHaveLength(0)
})
it('rejects fractional, future and nonfinite cursors', () => {
  for (const after of [1.5, 20, -1, 'no', null]) {
    const { socket } = setup(10)
    socket.emit('message', JSON.stringify({ type: 'auth', token: TOKEN, after }))
    expect(socket.code).toBe(4400)
  }
})
