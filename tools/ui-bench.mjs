/**
 * Interface benchmark in Electron (the desktop app's real renderer), using the lab's
 * SIMULATED FIXTURE "flood" scenario. Same harness for any version of the interface.
 *
 *   npm run lab:build -w packages/ui && npx electron tools/ui-bench.mjs [--runs 3] [--events 600] [--out file.json]
 *
 * Serves packages/ui/.lab-dist itself on a random local port; nothing leaves the machine.
 */
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
app.setPath('userData', mkdtempSync(join(tmpdir(), 'hydra-renderer-bench-')))

const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const runs = Number(opt('--runs', 3))
const events = Number(opt('--events', 600))
const scenario = opt('--scenario', 'flood')
const out = opt('--out', null)
const root = resolve(opt('--root', join(here, '..', 'packages', 'ui', '.lab-dist')))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }

function serve() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
      if (!path.startsWith(root) || !existsSync(path)) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' })
      res.end(readFileSync(path))
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

// The benchmark deliberately closes each window before creating the next one.
// Keep Electron alive between samples; otherwise its default quit races loadURL.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const server = await serve()
  const port = server.address().port
  const results = []
  for (let i = 0; i < runs; i++) {
    const win = new BrowserWindow({ width: 1440, height: 900, show: !opt('--shot', null), focusable: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false } })
    const started = Date.now()
    win.webContents.on('did-fail-load', (_e, code, desc, url) => process.stderr.write(`load failed ${code} ${desc} ${url}\n`))
    // The very first navigation of a fresh Electron process is occasionally aborted (ERR_FAILED); retry.
    let loaded = false
    for (let attempt = 0; attempt < 3 && !loaded; attempt++) {
      loaded = await win.loadURL(`http://127.0.0.1:${port}/lab.html?scenario=${scenario}&${opt('--shot', null) ? '' : 'bench=1&'}events=${events}${opt('--query', '')}`).then(() => true, (error) => { process.stderr.write(`loadURL: ${error.message}\n`); return false })
    }
    const loadMs = Date.now() - started
    const shot = opt('--shot', null)
    if (shot && loaded) {
      // Screenshot mode: wait, capture the window, done (no benchmark).
      await new Promise((r) => setTimeout(r, Number(opt('--at', 4000))))
      writeFileSync(shot, (await win.webContents.capturePage()).toPNG())
      win.destroy()
      continue
    }
    const cpuWindow = Number(opt('--cpu', 0))
    if (cpuWindow && loaded) {
      // CPU mode: average CPU of each Electron process type over a quiet window (no benchmark events).
      await new Promise((r) => setTimeout(r, 2500))
      const sample = () => Object.fromEntries(app.getAppMetrics().map((m) => [m.pid, { type: m.type, cpu: m.cpu.cumulativeCPUUsage ?? 0 }]))
      const a = sample(); const t = Date.now()
      await new Promise((r) => setTimeout(r, cpuWindow * 1000))
      const z = sample(); const secs = (Date.now() - t) / 1000
      const byType = {}
      for (const [pid, m] of Object.entries(z)) byType[m.type] = +(((byType[m.type] ?? 0) + ((m.cpu - (a[pid]?.cpu ?? m.cpu)) / secs) * 100)).toFixed(2)
      results.push({ cpuPercentOfOneCore: byType, seconds: secs, loadMs })
      win.destroy()
      continue
    }
    let result = null
    for (let t = 0; t < 600 && !result && loaded && !win.isDestroyed(); t++) {
      result = await win.webContents.executeJavaScript('window.__bench ?? null').catch(() => null)
      if (!result) await new Promise((r) => setTimeout(r, 100))
    }
    results.push({ ...(result ?? { error: 'no result' }), loadMs })
    if (!win.isDestroyed()) win.destroy()
  }
  const median = (key) => { const v = results.map((r) => r[key]).filter((x) => typeof x === 'number').sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? null }
  const summary = { scenario, events, runs: results, median: Object.fromEntries(['wallMs', 'avgFrameMs', 'maxFrameMs', 'framesOver50ms', 'longTasks', 'longTaskMs', 'heapDeltaMb', 'domNodes', 'loadMs'].map((k) => [k, median(k)])) }
  const text = JSON.stringify(summary, null, 2)
  if (out) writeFileSync(out, text)
  process.stdout.write(text + '\n')
  server.close()
  app.quit()
})
