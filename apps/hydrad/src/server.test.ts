import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { AdapterRegistry, Engine } from '@hydra/engine'
import { ScriptedAdapter } from '../../../packages/engine/src/agents/scripted.js'
import { cleanup, makeRepo, tempDir } from '../../../packages/engine/src/testing/fixtures.js'
import { startApiServer, type ApiServer } from './server.js'

const TOKEN = 'test-token-0123456789abcdef0123456789abcdef'
const open: Array<{ engine: Engine; server: ApiServer }> = []
const dirs: string[] = []
afterEach(async () => {
  for (const { engine, server } of open.splice(0)) { await server.close(); await engine.close() }
  cleanup(...dirs.splice(0))
})

async function boot() {
  const dataDir = tempDir('hydrad-')
  const ui = tempDir('hydrad-ui-')
  dirs.push(dataDir, ui)
  writeFileSync(join(ui, 'index.html'), '<!doctype html><title>Hydra</title>')
  mkdirSync(join(ui, 'assets'))
  writeFileSync(join(ui, 'assets', 'app.js'), 'console.log(1)')
  const engine = await Engine.open({ dataDir, registry: new AdapterRegistry([new ScriptedAdapter(() => ({ structured: { answer: 'ok', keyFindings: [], filesReferenced: [] } }))]), skipProbe: true })
  const server = await startApiServer({ engine, token: TOKEN, staticDir: ui })
  open.push({ engine, server })
  return { engine, server }
}

function call(server: ApiServer, path: string, opts: { method?: string; token?: string | null; host?: string; body?: unknown } = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    const req = request({
      host: '127.0.0.1', port: server.port, path, method: opts.method ?? 'GET',
      headers: {
        host: opts.host ?? `127.0.0.1:${server.port}`,
        ...(opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? TOKEN}` }),
        ...(data ? { 'content-type': 'application/json' } : {})
      }
    }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }))
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

describe('hydrad API security', () => {
  it('requires the bearer token for every API route except health', async () => {
    const { server } = await boot()
    expect((await call(server, '/api/health', { token: null })).status).toBe(200)
    expect((await call(server, '/api/state', { token: null })).status).toBe(401)
    expect((await call(server, '/api/state', { token: 'wrong' })).status).toBe(401)
    const ok = await call(server, '/api/state')
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.body).protocolVersion).toBe(1)
  })

  it('rejects DNS-rebinding hosts', async () => {
    const { server } = await boot()
    expect((await call(server, '/api/state', { host: `evil.example:${server.port}` })).status).toBe(421)
    expect((await call(server, '/', { host: 'attacker.test' })).status).toBe(421)
  })

  it('serves the UI with a strict CSP and never escapes the UI directory', async () => {
    const { server } = await boot()
    const index = await call(server, '/', { token: null })
    expect(index.status).toBe(200)
    expect(String(index.headers['content-security-policy'])).toContain("default-src 'self'")
    expect(String(index.headers['x-frame-options'])).toBe('DENY')
    const traversal = await call(server, '/..%2f..%2f..%2fWindows%2fwin.ini', { token: null })
    expect([403, 404]).toContain(traversal.status)
    expect(traversal.body).not.toMatch(/\[fonts\]|for 16-bit/i)
  })

  it('validates commands and returns typed acks', async () => {
    const { server } = await boot()
    const bad = await call(server, '/api/commands', { method: 'POST', body: { type: 'nope' } })
    expect(bad.status).toBe(400)
    expect(JSON.parse(bad.body)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    const repo = makeRepo({ 'a.txt': 'a' })
    dirs.push(repo)
    const added = await call(server, '/api/commands', { method: 'POST', body: { type: 'project.add', root: repo } })
    expect(added.status).toBe(200)
    expect(JSON.parse(added.body)).toMatchObject({ ok: true, result: { name: expect.any(String), isGit: true } })
  })

  it('streams journal events after WebSocket auth and replays from a cursor', async () => {
    const { server } = await boot()
    const repo = makeRepo({ 'a.txt': 'a' })
    dirs.push(repo)
    await call(server, '/api/commands', { method: 'POST', body: { type: 'project.add', root: repo } })

    const frames = await new Promise<Array<{ type: string; envelope?: { seq: number; event: { type: string } } }>>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/stream`)
      const got: Array<{ type: string }> = []
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: TOKEN, after: 0 })))
      ws.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type: string }
        got.push(frame)
        if (frame.type === 'ready') { ws.close(); resolve(got as never) }
      })
      ws.on('error', reject)
    })
    expect(frames.some((f) => f.envelope?.event.type === 'project.updated')).toBe(true)
    expect(frames.at(-1)!.type).toBe('ready')
  })

  it('closes unauthenticated streams and refuses foreign origins', async () => {
    const { server } = await boot()
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/stream`)
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: 'wrong', after: 0 })))
      ws.on('close', (c) => resolve(c))
    })
    expect(code).toBe(4401)
    const refused = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/stream`, { headers: { origin: 'https://evil.example' } })
      ws.on('open', () => resolve(false))
      ws.on('error', () => resolve(true))
    })
    expect(refused).toBe(true)
  })
  // Regression tests for the independent security review (docs/v2/SECURITY_AUDIT.md, findings R2, R3, T8).
  it('survives a malformed request target instead of crashing', async () => {
    const { server } = await boot()
    const reply = await rawRequest(server.port, `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`)
    expect(reply).toMatch(/^HTTP\/1\.1 400/)
    const upgrade = await rawRequest(server.port, `GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`)
    expect(upgrade).toMatch(/^HTTP\/1\.1 403/)
    expect((await call(server, '/api/health', { token: null })).status).toBe(200)
  })

  it('closes a stream whose first frame is JSON null and keeps serving', async () => {
    const { server } = await boot()
    const code = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/stream`)
      ws.on('open', () => ws.send('null'))
      ws.on('close', (c) => resolve(c))
    })
    expect(code).toBe(4400)
    expect((await call(server, '/api/health', { token: null })).status).toBe(200)
  })

  it('refuses API requests carrying a foreign Origin even with the token', async () => {
    const { server } = await boot()
    const res = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.port, path: '/api/state', headers: { host: `127.0.0.1:${server.port}`, origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` } }, (r) => { r.resume(); resolve(r.statusCode ?? 0) })
      req.on('error', reject)
      req.end()
    })
    expect(res).toBe(403)
  })
})

function rawRequest(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text))
    let data = ''
    socket.on('data', (c) => { data += String(c) })
    socket.on('close', () => resolve(data))
    socket.on('error', (e) => (data ? resolve(data) : reject(e)))
    setTimeout(() => socket.destroy(), 2000)
  })
}
