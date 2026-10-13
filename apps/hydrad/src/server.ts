import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Engine } from '@hydra/engine'
import type { EventEnvelope } from '@hydra/protocol'
import { bearerMatches, hostAllowed, originAllowed, SECURITY_HEADERS } from './security.js'

const MAX_BODY = 1024 * 1024
const MAX_LOG_BYTES = 5 * 1024 * 1024
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
}

export interface ApiServerOptions {
  engine: Engine
  token: string
  /** Directory with the built UI; omitted in API-only mode. */
  staticDir?: string
  port?: number
}

export interface ApiServer {
  port: number
  url: string
  close(): Promise<void>
}

/** Serves a file from a built UI directory (SPA fallback to index.html), never escaping it. */
export function serveStaticFile(res: ServerResponse, staticDir: string, path: string, headers: Record<string, string>): void {
  const root = resolve(staticDir)
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { return send(res, 400, { error: 'Bad path' }) }
  let file = normalize(join(root, decoded))
  if (!file.startsWith(root + sep) && file !== root) return send(res, 403, { error: 'Forbidden' })
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
  if (!existsSync(file)) return send(res, 404, { error: 'Not found' })
  const immutable = /[\\/]assets[\\/]/.test(file)
  res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
  createReadStream(file).pipe(res)
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  const payload = type === 'application/json' ? JSON.stringify(body) : String(body)
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store' })
  res.end(payload)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'Expected application/json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Request too large')
    chunks.push(chunk as Buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'Invalid JSON') }
}

export async function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const { engine, token } = options
  let port = 0

  const api = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    if (path === '/api/health') return send(res, 200, { ok: true })
    if (!bearerMatches(req.headers.authorization, token)) throw new HttpError(401, 'Unauthorized')
    const method = req.method ?? 'GET'
    let match: RegExpExecArray | null
    if (method === 'GET' && path === '/api/state') return send(res, 200, engine.snapshot())
    if (method === 'GET' && path === '/api/audit') return send(res, 200, engine.store.listAudit(300))
    if (method === 'POST' && path === '/api/commands') {
      const ack = await engine.execute(await readJson(req), { kind: 'desktop' })
      return send(res, ack.ok ? 200 : ack.error.code === 'not_found' ? 404 : ack.error.code === 'internal' ? 500 : 400, ack)
    }
    if (method === 'POST' && path === '/api/backup') return send(res, 200, { file: engine.backup() })
    if (method === 'GET' && (match = /^\/api\/tasks\/([0-9a-z]{26})$/.exec(path))) return send(res, 200, engine.taskDetail(match[1]!))
    if (method === 'GET' && (match = /^\/api\/tasks\/([0-9a-z]{26})\/diff$/.exec(path))) return send(res, 200, await engine.taskDiff(match[1]!))
    if (method === 'GET' && (match = /^\/api\/evidence\/([0-9a-z]{26})\/log$/.exec(path))) {
      const file = engine.evidenceLogPath(match[1]!)
      if (!file) throw new HttpError(404, 'Log not found')
      const size = statSync(file).size
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      createReadStream(file, { start: Math.max(0, size - MAX_LOG_BYTES) }).pipe(res)
      return
    }
    throw new HttpError(404, 'Not found')
  }

  const serveStatic = (res: ServerResponse, path: string): void => {
    if (!options.staticDir) return send(res, 404, { error: 'UI not bundled' })
    serveStaticFile(res, options.staticDir, path, SECURITY_HEADERS)
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        if (!hostAllowed(req, port)) throw new HttpError(421, 'Misdirected request')
        const path = new URL(req.url ?? '/', 'http://localhost').pathname
        if (path.startsWith('/api/')) await api(req, res, path)
        else if (req.method === 'GET') serveStatic(res, path)
        else throw new HttpError(405, 'Method not allowed')
      } catch (error) {
        const status = error instanceof HttpError ? error.status : (error as { code?: string }).code === 'not_found' ? 404 : 500
        if (!res.headersSent) send(res, status, { error: status === 500 ? 'Internal error' : (error as Error).message })
        else res.end()
      }
    })()
  })

  // ── live event stream ────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path !== '/api/stream' || !hostAllowed(req, port) || !originAllowed(req, port)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => attachStream(ws, engine, token))
  })

  await new Promise<void>((done) => server.listen(options.port ?? 0, '127.0.0.1', done))
  port = (server.address() as { port: number }).port
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((done) => {
      for (const client of wss.clients) client.terminate()
      wss.close()
      server.close(() => done())
      server.closeAllConnections()
    })
  }
}

/**
 * First client frame must be {type:'auth', token, after}. The server then replays
 * journal events after `after` and streams live events in order.
 */
function attachStream(ws: WebSocket, engine: Engine, token: string): void {
  let unsubscribe: (() => void) | null = null
  const authTimer = setTimeout(() => ws.close(4401, 'auth timeout'), 5000)
  const heartbeat = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping() }, 20_000)
  const sendEnvelope = (envelope: EventEnvelope) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'event', envelope })) }

  ws.once('message', (raw) => {
    clearTimeout(authTimer)
    let msg: { type?: unknown; token?: unknown; after?: unknown }
    try { msg = JSON.parse(String(raw)) as typeof msg } catch { return ws.close(4400, 'bad frame') }
    if (msg.type !== 'auth' || typeof msg.token !== 'string' || !bearerMatches(`Bearer ${msg.token}`, token)) return ws.close(4401, 'unauthorized')
    let cursor = typeof msg.after === 'number' && msg.after >= 0 ? msg.after : engine.store.lastSeq
    // Buffer live events while the backlog is replayed so nothing is lost or reordered.
    const live: EventEnvelope[] = []
    let replaying = true
    unsubscribe = engine.subscribe((envelope) => {
      if (replaying) live.push(envelope)
      else sendEnvelope(envelope)
    })
    for (let batch = engine.store.eventsAfter(cursor); batch.length; batch = engine.store.eventsAfter(cursor)) {
      for (const envelope of batch) { sendEnvelope(envelope); cursor = envelope.seq }
    }
    replaying = false
    for (const envelope of live) if (envelope.seq > cursor || envelope.event.type === 'run.output' || envelope.event.type === 'providers.updated') sendEnvelope(envelope)
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ready', lastSeq: engine.store.lastSeq }))
  })
  ws.on('close', () => { clearTimeout(authTimer); clearInterval(heartbeat); unsubscribe?.() })
  ws.on('error', () => ws.terminate())
}
