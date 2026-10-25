#!/usr/bin/env node
/**
 * Real agents, real app: two change tasks started at the same time in two repositories
 * (Claude Code plans and reviews, Codex implements), watched through the desktop app's
 * command center and Relay trace. Screenshots and the engine's own records are saved.
 *
 *   npm run build && node tools/relay-real.mjs [--out .hydra-dev/redesign/real]
 *
 * Uses your own provider accounts (each task capped at $0.60) and a temporary data directory.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'

const args = process.argv.slice(2)
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : '.hydra-dev/redesign/real')
mkdirSync(outDir, { recursive: true })
const PORT = 9343
const electron = createRequire(import.meta.url)('electron')
const dataDir = mkdtempSync(join(tmpdir(), 'hydra-relay-real-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-relay-repo-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'relay@example.invalid'); git('config', 'user.name', 'relay'); git('config', 'core.autocrlf', 'false'); git('add', '-A'); git('commit', '-qm', 'initial')
  return dir
}
const cart = repo({
  'package.json': JSON.stringify({ name: 'cart', private: true, scripts: { test: 'node --test' } }, null, 2),
  'cart.js': 'function total(items) {\n  return items.reduce((sum, item) => sum + item.price, 0)\n}\nmodule.exports = { total }\n',
  'cart.test.js': 'const { test } = require("node:test")\nconst assert = require("node:assert/strict")\nconst { total } = require("./cart.js")\ntest("total uses quantities", () => { assert.equal(total([{ price: 2, qty: 3 }, { price: 5, qty: 1 }]), 11) })\n'
})
const slug = repo({
  'package.json': JSON.stringify({ name: 'slug', private: true, scripts: { test: 'node --test' } }, null, 2),
  'slug.js': 'function slugify(text) {\n  return text.toLowerCase().replace(" ", "-")\n}\nmodule.exports = { slugify }\n',
  'slug.test.js': 'const { test } = require("node:test")\nconst assert = require("node:assert/strict")\nconst { slugify } = require("./slug.js")\ntest("every space becomes a dash", () => { assert.equal(slugify("Hello Big World"), "hello-big-world") })\n'
})

async function connect() {
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
        const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64')) }
        return { evaluate, shot, ws }
      }
    } catch { /* not up */ }
    await sleep(100)
  }
  throw new Error('no page')
}

const report = { at: new Date().toISOString(), screenshots: [], tasks: [] }
const app = spawn(electron, ['apps/desktop', `--remote-debugging-port=${PORT}`], { env: { ...process.env, HYDRA_DATA_DIR: dataDir }, stdio: 'ignore' })
try {
  const ui = await connect()
  for (let i = 0; i < 200 && !(await ui.evaluate('document.body?.innerText.length > 40')); i++) await sleep(50)
  const api = (path, body) => ui.evaluate(`fetch(window.hydraHost.apiUrl + ${JSON.stringify(path)}, { method: ${body ? "'POST'" : "'GET'"}, headers: { Authorization: 'Bearer ' + window.hydraHost.token, 'Content-Type': 'application/json' }${body ? `, body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then((r) => r.json())`)
  const clickText = (text) => ui.evaluate(`(() => { const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (el) el.click(); return !!el })()`)
  const assignment = { planner: 'claude', implementer: 'codex', reviewer: 'claude' }
  const budget = { maxCostUsd: 0.6 }
  const ids = []
  for (const [root, prompt] of [[cart, 'total() ignores item quantities, so the test fails. Fix total() in cart.js. Keep the change minimal.'], [slug, 'slugify() only replaces the first space. Fix it so every space becomes a dash. Keep the change minimal.']]) {
    const project = await api('/api/commands', { type: 'project.add', root })
    const ack = await api('/api/commands', { type: 'task.create', projectId: project.result.id, prompt, depth: 'deep', mode: 'developer', assignment, budget })
    if (!ack.ok) throw new Error(ack.error.message)
    ids.push(ack.result.id)
  }
  const started = Date.now()
  const elapsed = () => Math.round((Date.now() - started) / 1000)
  await clickText('Command center')
  const states = async () => Promise.all(ids.map((id) => api(`/api/tasks/${id}`)))
  let shots = 0
  let opened = false
  while (Date.now() - started < 12 * 60_000) {
    const details = await states()
    const running = details.flatMap((d) => d.runs.filter((r) => r.status === 'running').map((r) => `${d.task.title.slice(0, 12)}:${r.role}`))
    // While both run, the command center shows the shared agent slots.
    if (!opened && shots < 3 && running.length >= 2) { await ui.shot(`cc-${elapsed()}s`); report.screenshots.push({ at: elapsed(), view: 'command center', running }); shots++ }
    if (!opened && (shots >= 3 || elapsed() > 120)) {
      opened = await clickText(details[0].task.title.slice(0, 30))
    }
    if (opened && elapsed() % 20 < 5) { await ui.shot(`task-${elapsed()}s`); report.screenshots.push({ at: elapsed(), view: 'task', stage: details[0].task.stage, status: details[0].task.status }) }
    if (details.every((d) => !['queued', 'running'].includes(d.task.status))) break
    await sleep(5000)
  }
  await sleep(1500)
  if (!opened) await clickText((await states())[0].task.title.slice(0, 30))
  await sleep(1500)
  await ui.shot('task-final')
  // Zoom into an operation: the implementer's run.
  await ui.evaluate(`(() => { const seg = [...document.querySelectorAll('.relay__seg--run')].find((s) => (s.getAttribute('aria-label') || '').startsWith('Implementer')); if (seg) seg.click(); return !!seg })()`)
  await sleep(800)
  await ui.shot('task-final-implementer')
  await ui.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'List'); if (b) b.click(); return !!b })()`)
  await sleep(600)
  await ui.shot('task-final-list')
  for (const d of await states()) {
    report.tasks.push({
      title: d.task.title, status: d.task.status, waitReason: d.task.waitReason, outcome: d.task.outcome, costUsd: d.task.usage.costUsd, fixRounds: d.task.fixRound,
      selection: d.task.selection,
      stages: d.task.stages.map((s) => `${s.stage}#${s.attempt} ${s.status}${s.note ? `: ${s.note}` : ''}`),
      runs: d.runs.map((r) => ({ role: r.role, provider: r.provider, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, toolCalls: r.activity.length, kinds: [...new Set(r.activity.map((a) => a.kind))] })),
      checks: d.evidence.map((e) => `${e.phase} ${e.label} exit ${e.exitCode}`)
    })
  }
  // Real concurrency: intervals where runs of the two tasks overlapped.
  const all = report.tasks.flatMap((t, i) => t.runs.map((r) => ({ task: i, start: Date.parse(r.startedAt), end: Date.parse(r.endedAt ?? new Date().toISOString()) })))
  report.overlapSeconds = Math.round(all.filter((a) => a.task === 0).reduce((n, a) => n + all.filter((b) => b.task === 1).reduce((m, b) => m + Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)), 0), 0) / 1000)
  report.totalSeconds = elapsed()
} finally {
  app.kill()
  try { execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* gone */ }
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
