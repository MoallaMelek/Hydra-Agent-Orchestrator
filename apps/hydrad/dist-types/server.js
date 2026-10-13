import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { bearerMatches, hostAllowed, originAllowed, safePath, SECURITY_HEADERS } from './security.js';
const MAX_BODY = 1024 * 1024;
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json'
};
/** Serves a file from a built UI directory (SPA fallback to index.html), never escaping it. */
export function serveStaticFile(res, staticDir, path, headers) {
    const root = resolve(staticDir);
    let decoded;
    try {
        decoded = decodeURIComponent(path);
    }
    catch {
        return send(res, 400, { error: 'Bad path' });
    }
    let file = normalize(join(root, decoded));
    if (!file.startsWith(root + sep) && file !== root)
        return send(res, 403, { error: 'Forbidden' });
    if (!existsSync(file) || statSync(file).isDirectory())
        file = join(root, 'index.html');
    if (!existsSync(file))
        return send(res, 404, { error: 'Not found' });
    const immutable = /[\\/]assets[\\/]/.test(file);
    res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
    createReadStream(file).pipe(res);
}
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export function send(res, status, body, type = 'application/json') {
    const payload = type === 'application/json' ? JSON.stringify(body) : String(body);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(payload);
}
async function readJson(req) {
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? ''))
        throw new HttpError(415, 'Expected application/json');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY)
            throw new HttpError(413, 'Request too large');
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        throw new HttpError(400, 'Invalid JSON');
    }
}
export async function startApiServer(options) {
    const { engine, token } = options;
    let port = 0;
    const api = async (req, res, path) => {
        if (path === '/api/health')
            return send(res, 200, { ok: true });
        if (!bearerMatches(req.headers.authorization, token))
            throw new HttpError(401, 'Unauthorized');
        const method = req.method ?? 'GET';
        let match;
        if (method === 'GET' && path === '/api/state')
            return send(res, 200, engine.snapshot());
        if (method === 'GET' && path === '/api/audit')
            return send(res, 200, engine.store.listAudit(300));
        if (method === 'POST' && path === '/api/commands') {
            const ack = await engine.execute(await readJson(req), { kind: 'desktop' });
            return send(res, ack.ok ? 200 : ack.error.code === 'not_found' ? 404 : ack.error.code === 'internal' ? 500 : 400, ack);
        }
        if (method === 'POST' && path === '/api/backup')
            return send(res, 200, { file: engine.backup() });
        if (method === 'POST' && path === '/api/export')
            return send(res, 200, { file: engine.exportData() });
        if (method === 'GET' && (match = /^\/api\/tasks\/([0-9a-z]{26})$/.exec(path)))
            return send(res, 200, engine.taskDetail(match[1]));
        if (method === 'GET' && (match = /^\/api\/tasks\/([0-9a-z]{26})\/diff$/.exec(path)))
            return send(res, 200, await engine.taskDiff(match[1]));
        if (method === 'GET' && (match = /^\/api\/evidence\/([0-9a-z]{26})\/log$/.exec(path))) {
            const file = engine.evidenceLogPath(match[1]);
            if (!file)
                throw new HttpError(404, 'Log not found');
            const size = statSync(file).size;
            res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            createReadStream(file, { start: Math.max(0, size - MAX_LOG_BYTES) }).pipe(res);
            return;
        }
        throw new HttpError(404, 'Not found');
    };
    const serveStatic = (res, path) => {
        if (!options.staticDir)
            return send(res, 404, { error: 'UI not bundled' });
        serveStaticFile(res, options.staticDir, path, SECURITY_HEADERS);
    };
    const server = createServer((req, res) => {
        void (async () => {
            try {
                if (!hostAllowed(req, port))
                    throw new HttpError(421, 'Misdirected request');
                if (!originAllowed(req, port))
                    throw new HttpError(403, 'Forbidden origin');
                const path = safePath(req.url);
                if (path === null)
                    throw new HttpError(400, 'Bad request');
                if (path.startsWith('/api/'))
                    await api(req, res, path);
                else if (req.method === 'GET')
                    serveStatic(res, path);
                else
                    throw new HttpError(405, 'Method not allowed');
            }
            catch (error) {
                const status = error instanceof HttpError ? error.status : error.code === 'not_found' ? 404 : 500;
                if (!res.headersSent)
                    send(res, status, { error: status === 500 ? 'Internal error' : error.message });
                else
                    res.end();
            }
        })();
    });
    // ── live event stream ────────────────────────────────────────
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    server.on('clientError', (_error, socket) => socket.destroy());
    server.on('upgrade', (req, socket, head) => {
        socket.on('error', () => socket.destroy());
        const path = safePath(req.url);
        if (path !== '/api/stream' || !hostAllowed(req, port) || !originAllowed(req, port)) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => attachStream(ws, engine, token));
    });
    await new Promise((done) => server.listen(options.port ?? 0, '127.0.0.1', done));
    port = server.address().port;
    return {
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => {
            for (const client of wss.clients)
                client.terminate();
            wss.close();
            server.close(() => done());
            server.closeAllConnections();
        })
    };
}
/**
 * First client frame must be {type:'auth', token, after}. The server then replays
 * journal events after `after` and streams live events in order.
 */
function attachStream(ws, engine, token) {
    let unsubscribe = null;
    const authTimer = setTimeout(() => ws.close(4401, 'auth timeout'), 5000);
    const heartbeat = setInterval(() => { if (ws.readyState === ws.OPEN)
        ws.ping(); }, 20_000);
    const sendEnvelope = (envelope) => { if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ type: 'event', envelope })); };
    ws.once('message', (raw) => {
        clearTimeout(authTimer);
        let msg;
        try {
            msg = JSON.parse(String(raw));
        }
        catch {
            return ws.close(4400, 'bad frame');
        }
        if (!msg || typeof msg !== 'object' || Array.isArray(msg))
            return ws.close(4400, 'bad frame');
        if (msg.type !== 'auth' || typeof msg.token !== 'string' || !bearerMatches(`Bearer ${msg.token}`, token))
            return ws.close(4401, 'unauthorized');
        let cursor = typeof msg.after === 'number' && msg.after >= 0 ? msg.after : engine.store.lastSeq;
        // Buffer live events while the backlog is replayed so nothing is lost or reordered.
        const live = [];
        let replaying = true;
        unsubscribe = engine.subscribe((envelope) => {
            if (replaying)
                live.push(envelope);
            else
                sendEnvelope(envelope);
        });
        for (let batch = engine.store.eventsAfter(cursor); batch.length; batch = engine.store.eventsAfter(cursor)) {
            for (const envelope of batch) {
                sendEnvelope(envelope);
                cursor = envelope.seq;
            }
        }
        replaying = false;
        for (const envelope of live)
            if (envelope.seq > cursor || envelope.event.type === 'run.output' || envelope.event.type === 'providers.updated')
                sendEnvelope(envelope);
        if (ws.readyState === ws.OPEN)
            ws.send(JSON.stringify({ type: 'ready', lastSeq: engine.store.lastSeq }));
    });
    ws.on('close', () => { clearTimeout(authTimer); clearInterval(heartbeat); unsubscribe?.(); });
    ws.on('error', () => ws.terminate());
}
//# sourceMappingURL=server.js.map