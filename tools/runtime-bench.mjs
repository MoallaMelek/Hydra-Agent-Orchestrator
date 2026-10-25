#!/usr/bin/env node
/**
 * Measures the real desktop app (Electron + engine), not the lab:
 *   - startup: launch → first paint → interface rendered;
 *   - idle: CPU and memory of every Hydra process over a quiet window;
 *   - optionally one real question to a real agent (--question "..."): total time as the
 *     engine reports it, and each process's CPU while the answer is produced (the
 *     interface stays on its start screen; this is not on-screen latency).
 *
 *   npm run build && node tools/runtime-bench.mjs [--idle 20] [--question "What does math.js export?"] [--out file.json]
 *
 * Uses a fresh temporary data directory. --question uses your own provider account.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const args = process.argv.slice(2)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const idleSeconds = Number(opt('--idle', 20))
const question = opt('--question', null)
const out = opt('--out', null)
const PORT = 9341
const electron = createRequire(import.meta.url)('electron')
const dataDir = mkdtempSync(join(tmpdir(), 'hydra-runtime-bench-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Every process in the tree under `root`, with CPU seconds and memory (Windows). */
function tree(root) {
  const script = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine, KernelModeTime, UserModeTime, WorkingSetSize, PrivatePageCount
$ids = New-Object System.Collections.Generic.HashSet[int]; [void]$ids.Add(${root})
do { $added = 0; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $added++ } } } while ($added -gt 0)
$all | Where-Object { $ids.Contains([int]$_.ProcessId) } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; type = if ($_.CommandLine -match '--type=([a-z-]+)') { $matches[1] } elseif ($_.CommandLine -match 'hydrad') { 'engine' } elseif ($_.Name -match 'electron') { 'main' } else { $_.Name }; cpu = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 1e7; ws = [math]::Round($_.WorkingSetSize / 1MB, 1); priv = [math]::Round($_.PrivatePageCount / 1MB, 1) } } | ConvertTo-Json -Compress`
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim()
  const list = raw ? JSON.parse(raw) : []
  return Array.isArray(list) ? list : [list]
}

const byType = (procs) => {
  const sum = {}
  for (const p of procs) {
    const key = p.type
    sum[key] ??= { count: 0, wsMb: 0, privateMb: 0 }
    sum[key].count++; sum[key].wsMb += p.ws; sum[key].privateMb += p.priv
  }
  for (const v of Object.values(sum)) { v.wsMb = +v.wsMb.toFixed(1); v.privateMb = +v.privateMb.toFixed(1) }
  return sum
}

async function cdpConnect() {
  for (let i = 0; i < 240; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail) })
        let next = 0
        const pending = new Map()
        ws.on('message', (raw) => { const m = JSON.parse(String(raw)); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
        const send = (method, params = {}) => new Promise((ok) => { const id = ++next; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })) })
        const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
        return { ws, evaluate }
      }
    } catch { /* not up yet */ }
    await sleep(50)
  }
  throw new Error('no page')
}

const result = { at: new Date().toISOString(), logicalCpus: cpus().length }
const t0 = Date.now()
const app = spawn(electron, [opt('--app', 'apps/desktop'), `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(dataDir, 'electron-profile')}`], { env: { ...process.env, HYDRA_DATA_DIR: dataDir }, stdio: 'ignore' })
try {
  const page = await cdpConnect()
  result.pageTargetMs = Date.now() - t0
  // Rendered: the sidebar brand and some main content exist.
  for (let i = 0; i < 400; i++) {
    const ready = await page.evaluate(`!!document.querySelector('#root') && document.querySelector('#root').innerText.length > 40`)
    if (ready) break
    await sleep(25)
  }
  result.renderedMs = Date.now() - t0
  result.paint = await page.evaluate(`Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]))`)
  result.navigation = await page.evaluate(`(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null })()`)

  await sleep(Number(opt('--warmup', 3)) * 1000)
  const before = tree(app.pid)
  const idleStart = Date.now()
  await sleep(idleSeconds * 1000)
  const after = tree(app.pid)
  const seconds = (Date.now() - idleStart) / 1000
  const cpuOf = (list, type) => list.filter((p) => !type || p.type === type).reduce((n, p) => n + p.cpu, 0)
  const pct = (type) => +(((cpuOf(after, type) - cpuOf(before, type)) / seconds) * 100).toFixed(2)
  result.idle = {
    seconds: +seconds.toFixed(1),
    cpuPercentOfOneCore: { total: pct(null), renderer: pct('renderer'), gpu: pct('gpu-process'), main: pct('main'), engine: pct('engine') },
    memory: byType(after),
    totalWsMb: +after.reduce((n, p) => n + p.ws, 0).toFixed(1),
    totalPrivateMb: +after.reduce((n, p) => n + p.priv, 0).toFixed(1)
  }

  if (question) {
    const repo = mkdtempSync(join(tmpdir(), 'hydra-runtime-repo-'))
    writeFileSync(join(repo, 'math.js'), 'function add(a, b) {\n  return a + b\n}\nmodule.exports = { add }\n')
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'bench@example.invalid'); git('config', 'user.name', 'bench'); git('add', '-A'); git('commit', '-qm', 'init')
    const api = (path, body) => page.evaluate(`fetch(window.hydraHost.apiUrl + ${JSON.stringify(path)}, { method: ${body ? "'POST'" : "'GET'"}, headers: { Authorization: 'Bearer ' + window.hydraHost.token, 'Content-Type': 'application/json' }${body ? `, body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then((r) => r.json())`)
    const project = await api('/api/commands', { type: 'project.add', root: repo })
    const projectId = project.result.id
    const cpuBefore = tree(app.pid)
    const asked = Date.now()
    const ack = await api('/api/commands', { type: 'task.create', projectId, prompt: question, depth: 'standard', mode: 'safe', assignment: { planner: 'claude', implementer: 'claude', reviewer: 'claude' } })
    if (!ack.ok) throw new Error(ack.error.message)
    const taskId = ack.result.id
    let firstWords = null
    let done = null
    for (let i = 0; i < 1200 && !done; i++) {
      const state = await api(`/api/tasks/${taskId}`)
      // Engine-side (API) timing: when the run record first carries text. Not on-screen latency.
      if (firstWords === null && (state.runs ?? []).some((r) => r.tail && r.tail.trim())) firstWords = Date.now() - asked
      if (!['queued', 'running'].includes(state.task.status)) done = { ms: Date.now() - asked, status: state.task.status, costUsd: state.task.usage.costUsd }
      else await sleep(100)
    }
    const cpuAfter = tree(app.pid)
    const secs = (Date.now() - asked) / 1000
    const delta = (type) => +(((cpuOf(cpuAfter, type) - cpuOf(cpuBefore, type)) / secs) * 100).toFixed(2)
    // The interface stays on its start screen during this measurement (it does not open the task).
    result.question = { prompt: question, view: 'start screen', engineFirstTextMs: firstWords, ...done, cpuPercentOfOneCore: { renderer: delta('renderer'), gpu: delta('gpu-process'), main: delta('main'), engine: delta('engine') } }
  }
} finally {
  app.kill()
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ }
}
const text = JSON.stringify(result, null, 2)
if (out) writeFileSync(out, text)
console.log(text)
