#!/usr/bin/env node
/**
 * Drives the real Electron desktop app (not a browser) through the Chrome DevTools
 * Protocol and records what happened, with a screenshot per step.
 *
 *   npm run build && node tools/desktop-e2e.mjs [--out <dir>] [--no-agents]
 *
 * Uses a fresh, temporary data directory. With agents enabled it starts one real
 * Safe-mode task (one planning call on the customer's own provider account, capped at
 * $0.50) and rejects the plan, then starts and stops a second task.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import WebSocket from 'ws'

const args = process.argv.slice(2)
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : '.hydra-dev/desktop-e2e')
const missingProviders = args.includes('--simulate-missing-providers')
const useAgents = !args.includes('--no-agents') && !missingProviders
const PORT = 9333
mkdirSync(outDir, { recursive: true })
const electron = createRequire(import.meta.url)('electron')
const dataDir = mkdtempSync(join(tmpdir(), 'hydra-desktop-e2e-'))
const report = { startedAt: new Date().toISOString(), dataDir, steps: [] }
const pageErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'hydra-e2e-repo-'))
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'e2e-fixture', private: true, scripts: { test: 'node --test' } }, null, 2))
  writeFileSync(join(repo, 'math.js'), 'function add(a, b) {\n  return a - b\n}\nmodule.exports = { add }\n')
  writeFileSync(join(repo, 'math.test.js'), 'const { test } = require("node:test")\nconst assert = require("node:assert/strict")\nconst { add } = require("./math.js")\ntest("add", () => { assert.equal(add(2, 3), 5) })\n')
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'e2e@example.invalid'); git('config', 'user.name', 'e2e'); git('config', 'core.autocrlf', 'false')
  git('add', '-A'); git('commit', '-qm', 'initial')
  return repo
}

/** A machine without the agent CLIs: empty profile directories and a PATH holding only git. */
function hiddenProviderEnv() {
  const home = mkdtempSync(join(tmpdir(), 'hydra-e2e-home-'))
  for (const sub of ['Roaming', 'Local']) mkdirSync(join(home, 'AppData', sub), { recursive: true })
  const git = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
  const system = process.platform === 'win32' ? [join(process.env.SystemRoot ?? 'C:/Windows', 'System32')] : ['/usr/bin', '/bin']
  return { PATH: [dirname(git), ...system].join(delimiter), Path: undefined, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), HYDRA_CLAUDE_PATH: undefined, HYDRA_CODEX_PATH: undefined }
}

function launch() {
  const env = { ...process.env, HYDRA_DATA_DIR: dataDir, ...(missingProviders ? hiddenProviderEnv() : {}) }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  return spawn(electron, ['apps/desktop', `--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' })
}

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = targets.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(t.url))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail) })
        let next = 0
        const pending = new Map()
        ws.on('message', (raw) => {
          const m = JSON.parse(String(raw))
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
          // Page errors are evidence: record them in the report.
          if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)
          if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
        })
        const send = (method, params = {}) => new Promise((ok) => { const id = ++next; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })) })
        await send('Runtime.enable')
        return { ws, send }
      }
    } catch { /* not up yet */ }
    await sleep(500)
  }
  throw new Error('Electron page did not appear on the debugging port')
}

function driver(cdp) {
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.error) throw new Error(r.error.message)
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluation failed')
    return r.result?.result?.value
  }
  const text = async () => (await evaluate('document.body ? document.body.innerText : ""')) ?? ''
  const waitText = async (needle, ms = 30_000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { if ((await text()).toLowerCase().includes(needle.toLowerCase())) return true } catch { /* page still loading */ }
      await sleep(300)
    }
    throw new Error(`Timed out waiting for "${needle}"`)
  }
  // Retries briefly: React may not have re-rendered the button yet after typing.
  const click = async (label) => {
    for (let i = 0; ; i++) {
      try { return await clickNow(label) } catch (error) { if (i >= 20) throw error; await sleep(150) }
    }
  }
  const clickNow = (label) => evaluate(`(() => {
    const enabled = [...document.querySelectorAll('button')].filter((b) => !b.disabled)
    // Visible text first: an icon button's accessible label can repeat a visible label elsewhere.
    const byText = enabled.filter((b) => b.textContent.trim() === ${JSON.stringify(label)})
    const els = byText.length ? byText : enabled.filter((b) => b.getAttribute('aria-label') === ${JSON.stringify(label)})
    if (!els.length) throw new Error('No enabled button ' + ${JSON.stringify(label)})
    els[0].click(); return true })()`)
  const type = (selector, value) => evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const api = (path) => evaluate(`fetch(window.hydraHost.apiUrl + ${JSON.stringify(path)}, { headers: { Authorization: 'Bearer ' + window.hydraHost.token } }).then((r) => r.json())`)
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const file = join(outDir, `${name}.png`)
    writeFileSync(file, Buffer.from(r.result.data, 'base64'))
    return file
  }
  const until = async (predicate, ms = 60_000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { const state = await api('/api/state'); const hit = predicate(state); if (hit) return hit; await sleep(500) }
    throw new Error('Timed out waiting for engine state')
  }
  return { evaluate, text, waitText, click, type, api, shot, until }
}

async function step(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    report.steps.push({ name, result: 'PASS', ms: Date.now() - started, ...(detail ? { detail } : {}) })
    console.log(`PASS ${name}`)
  } catch (error) {
    report.steps.push({ name, result: 'FAIL', ms: Date.now() - started, error: error.message, pageErrors: pageErrors.slice(-5) })
    await ui?.shot(`fail-${report.steps.length}`).catch(() => {})
    console.log(`FAIL ${name}: ${error.message}`)
    throw error
  }
}

const repo = makeRepo()
let app = launch()
let ui
try {
  ui = driver(await connect())
  await step('first run shows the setup checklist with real provider detection', async () => {
    await ui.waitText('Get started')
    const state = await ui.api('/api/state')
    const providers = state.providers.map((p) => ({ id: p.id, installed: p.installed, authenticated: p.authenticated, problems: p.problems.length }))
    await ui.shot(missingProviders ? '01-first-run-no-providers' : '01-first-run')
    if (missingProviders && providers.some((p) => p.installed)) throw new Error('providers were still detected')
    if (missingProviders) await ui.waitText('npm install -g @anthropic-ai/claude-code')
    return { providers }
  })
  await step('add a project by typing its path', async () => {
    await ui.click('Add a project')
    await ui.waitText('Project folder')
    await ui.type('#project-root', repo)
    await ui.click('Add project')
    await ui.waitText('New task')
    await ui.shot('02-project')
  })
  if (useAgents) {
    const toProject = async () => {
      await ui.evaluate(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.includes(${JSON.stringify(basename(repo))})).click()`)
      await ui.waitText('Ask a question or describe a change')
    }
    const openLimits = () => ui.evaluate("document.querySelector('#budget-cost') || [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Agents and limits')).click()")
    await step('a casual question: Auto picks a quick answer, the reply streams in and reads naturally', async () => {
      await ui.type('#task-prompt', 'hi! what does this project do, in a sentence or two?')
      await ui.waitText('Auto → Quick answer')
      await ui.click('Ask')
      const task = await ui.until((s) => s.tasks.find((t) => t.intent === 'analyze' && t.status !== 'running' && t.status !== 'queued'), 240_000)
      if (task.status !== 'completed' || !task.answer) throw new Error(`question ${task.status}: ${task.error}`)
      if (task.route?.depth !== 'fast' || task.usage.agentRuns !== 1) throw new Error(`expected one quick run, got ${task.route?.depth} with ${task.usage.agentRuns} runs`)
      await ui.waitText('Hydra ·')
      await ui.shot('03a-question')
      const narrated = /\b(pipeline|this stage|read-only (mode|access)|structured output)\b/i.test(task.answer)
      if (narrated) throw new Error('the reply narrates how it was run')
      if (/^#{1,6} /m.test(await ui.text())) throw new Error('raw Markdown headings are visible')
      return { answer: task.answer.slice(0, 300), costUsd: task.usage.costUsd }
    })
    await step('a follow-up continues the conversation', async () => {
      await ui.type('textarea[aria-label="Ask a follow-up"]', 'and which file holds the main logic?')
      await ui.click('Send')
      const task = await ui.until((s) => s.tasks.find((t) => t.followUpOf && t.status !== 'running' && t.status !== 'queued'), 240_000)
      if (task.status !== 'completed' || !/math\.js/.test(task.answer ?? '')) throw new Error(`follow-up ${task.status}: ${(task.answer ?? task.error ?? '').slice(0, 200)}`)
      await ui.shot('03b-follow-up')
      return { answer: task.answer.slice(0, 300) }
    })
    await step('a question forced into the full pipeline is answered without a plan', async () => {
      await toProject()
      await ui.type('#task-prompt', 'are you a good tool for this repo?')
      await ui.click('Full change')
      await ui.click('Start change')
      const task = await ui.until((s) => s.tasks.find((t) => t.prompt.startsWith('are you a good tool') && t.status !== 'running' && t.status !== 'queued'), 240_000)
      await ui.shot('03c-question-as-change')
      if (task.status !== 'completed' || task.outcome !== 'answered') throw new Error(`expected an answer, got ${task.status}/${task.outcome}/${task.waitReason}`)
      return { answer: task.answer.slice(0, 300), workspaceRemoved: task.workspace?.removed ?? null }
    })
    await step('a change: Auto picks the full pipeline; Safe stops for plan approval; rejecting discards it', async () => {
      await toProject()
      await ui.type('#task-prompt', 'Fix add() in math.js so the test passes. Keep the change minimal.')
      await ui.waitText('Auto → Full change')
      await ui.click('Safe')
      await openLimits()
      await ui.type('#budget-cost', '0.5')
      await ui.click('Start change')
      const task = await ui.until((s) => s.tasks.find((t) => t.intent === 'change' && t.prompt.startsWith('Fix add()') && (t.status === 'waiting_input' || t.status === 'failed' || t.status === 'paused')), 300_000)
      if (task.status !== 'waiting_input') throw new Error(`task ${task.status}: ${task.error}`)
      await ui.waitText('Approve the plan and checks?')
      await ui.shot('03-plan-approval')
      await ui.click('Reject')
      const done = await ui.until((s) => s.tasks.find((t) => t.id === task.id && t.status === 'completed'))
      await ui.shot('04-rejected')
      return { route: task.route?.depth, waitReason: task.waitReason, outcome: done.outcome, costUsd: done.usage.costUsd }
    })
    await step('a running change stops promptly', async () => {
      await toProject()
      await ui.type('#task-prompt', 'Add a short comment above add() explaining what it does.')
      await ui.click('Developer')
      await openLimits()
      await ui.type('#budget-cost', '0.5')
      await ui.click('Start change')
      const task = await ui.until((s) => s.tasks.find((t) => t.status === 'running' && t.mode === 'developer'))
      await ui.waitText('Stop')
      await ui.click('Stop')
      const stopped = await ui.until((s) => s.tasks.find((t) => t.id === task.id && t.status === 'canceled'), 15_000)
      await ui.shot('05-stopped')
      return { status: stopped.status, stage: stopped.stage }
    })
  }
  await step('settings: back up and export from the UI', async () => {
    await ui.click('Settings')
    await ui.waitText('Your data')
    await ui.click('Back up now')
    await ui.waitText('Saved to')
    const backup = (await ui.text()).match(/Saved to\s+(\S+\.db)/)?.[1]
    await ui.click('Export as JSON')
    await ui.waitText('.json')
    const exported = (await ui.text()).match(/Saved to\s+(\S+\.json)/)?.[1]
    await ui.shot('06-settings')
    if (!backup || !exported || !existsSync(backup) || !existsSync(exported)) throw new Error('backup or export file missing')
    return { backup, exported }
  })
  await step('quitting stops the engine and releases the data lock', async () => {
    await ui.evaluate('window.close()').catch(() => {})
    const exited = await Promise.race([new Promise((r) => app.once('exit', () => r(true))), sleep(20_000).then(() => false)])
    if (!exited) throw new Error('app did not exit')
    await sleep(3000)
    if (existsSync(join(dataDir, 'engine.lock'))) throw new Error('engine.lock still present: engine outlived the app')
  })
  await step('relaunch keeps projects and task history', async () => {
    app = launch()
    ui = driver(await connect())
    await ui.waitText('Overview')
    const state = await ui.api('/api/state')
    await ui.shot('07-relaunch')
    if (state.projects.length !== 1) throw new Error(`expected 1 project, got ${state.projects.length}`)
    return { projects: state.projects.length, tasks: state.tasks.map((t) => `${t.status}/${t.outcome ?? '-'}`) }
  })
} catch (error) {
  // Failures inside steps are already recorded; anything else (e.g. launch) is recorded here.
  if (!report.steps.some((s) => s.result === 'FAIL')) report.steps.push({ name: 'setup', result: 'FAIL', error: error.message })
} finally {
  if (ui) await ui.evaluate('window.close()').catch(() => {})
  await sleep(2000)
  if (app.exitCode === null) app.kill()
  report.finishedAt = new Date().toISOString()
  report.passed = report.steps.length > 0 && report.steps.every((s) => s.result === 'PASS')
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`\n${report.passed ? 'ALL PASSED' : 'FAILED'}: report and screenshots in ${outDir}`)
  process.exitCode = report.passed ? 0 : 1
}
