#!/usr/bin/env node
/** Inspects an existing disposable real-agent run. Starts no new agent work. */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import WebSocket from 'ws'

const [dataDir, output] = process.argv.slice(2)
if (!dataDir || !basename(dataDir).startsWith('hydra-relay-real-') || !output) throw new Error('Supply this test run’s disposable hydra-relay-real directory and output directory')
const out = resolve(output); mkdirSync(out, { recursive: true })
const electron = createRequire(import.meta.url)('electron')
const port = 9357
const child = spawn(electron, ['apps/desktop', `--remote-debugging-port=${port}`, `--user-data-dir=${join(dataDir, 'electron-capture')}`], { env: { ...process.env, HYDRA_DATA_DIR: dataDir }, stdio: 'ignore' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let ws
const report = { data: 'Recorded real Claude/Codex operations; no new tasks started', screenshots: [], checks: [] }
try {
  for (let attempt = 0; attempt < 200 && !ws; attempt++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
      const target = targets.find(target => target.type === 'page' && target.url.startsWith('http://127.0.0.1:'))
      if (target) { ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) }) }
    } catch { ws = null }
    if (!ws) await sleep(100)
  }
  if (!ws) throw new Error('Native page did not open')
  let id = 0
  const pending = new Map()
  ws.on('message', raw => { const result = JSON.parse(String(raw)); if (pending.has(result.id)) { pending.get(result.id)(result); pending.delete(result.id) } })
  const send = (method, params = {}) => new Promise(resolve => { const key = ++id; pending.set(key, resolve); ws.send(JSON.stringify({ id: key, method, params })) })
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.exception?.description ?? 'Page evaluation failed')
    return result.result?.result?.value
  }
  const until = async expression => { for (let index = 0; index < 200; index++) { try { if (await evaluate(expression)) return } catch { /* document may not exist before first navigation */ } await sleep(100) } throw new Error('Timed out: ' + expression) }
  const click = async text => { await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}); if (!button) throw new Error('Missing button'); button.click() })()`); await sleep(250) }
  const api = path => evaluate(`fetch(window.hydraHost.apiUrl + ${JSON.stringify(path)}, {headers:{Authorization:'Bearer '+window.hydraHost.token}}).then(response=>response.json())`)
  const shot = async name => {
    await sleep(250)
    const result = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(out, name + '.png'), Buffer.from(result.result.data, 'base64')); report.screenshots.push(name + '.png')
  }
  await until('document.body.innerText.includes("Command center")')
  const before = await api('/api/state')
  const tasks = before.tasks
  if (tasks.length !== 2 || tasks.some(task => task.waitReason !== 'final_approval')) throw new Error('Expected exactly the two completed real-run fixtures at final approval')
  const openTask = async task => { await click('Command center'); await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.includes(${JSON.stringify(task.title.slice(0, 30))})).click()`); await until('document.querySelector(".workfloor") !== null') }
  await openTask(tasks[0])
  await click('Settings'); await click('Midnight'); await openTask(tasks[0])
  await shot('01-workspaces-midnight')
  await evaluate('[...document.querySelectorAll(".station__select")].find(button => button.textContent.includes("Make the change")).click()')
  await shot('02-agent-operation-evidence')
  await click('Timeline'); await shot('03-timeline')
  const detail = await api('/api/tasks/' + tasks[0].id)
  const first = detail.runs[0]
  const replayAt = Date.parse(first.startedAt) + (Date.parse(first.endedAt) - Date.parse(first.startedAt)) / 2
  await evaluate(`(() => { const input=document.querySelector('input[aria-label="Replay position"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${replayAt}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
  await until('document.body.innerText.includes("paused in time")')
  const labels = await evaluate('[...document.querySelectorAll(".relay__seg--run")].map(element=>element.getAttribute("aria-label"))')
  if (labels.some(label => label.includes(', done'))) throw new Error('Future completion leaked into replay')
  report.checks.push('Historical execution is running before its recorded completion; latest output inspector is hidden.')
  await shot('04-historical-replay')
  await click('Back to now'); await click('Evidence path'); await shot('05-evidence-path')
  for (const theme of ['Terracotta', 'Light']) {
    await click('Settings'); await click(theme); await openTask(tasks[0]); await shot('06-workspaces-' + theme.toLowerCase())
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await shot('07-mobile-workspaces')
  if (await evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth')) throw new Error('Mobile overflow')
  await send('Emulation.clearDeviceMetricsOverride')
  await click('Freeze view'); await openTask(tasks[1])
  if (await evaluate('document.body.innerText.includes("Resume view")')) throw new Error('Frozen view leaked into another task')
  report.checks.push('Frozen task-specific view does not survive switching to the other task.')
  await shot('08-second-task')
  const after = await api('/api/state')
  if (after.tasks.length !== before.tasks.length || after.tasks.some(task => task.waitReason !== 'final_approval')) throw new Error('Inspection mutated task execution')
  report.checks.push('No tasks, approvals or results were mutated by inspection.')
  report.passed = true
  await evaluate('window.close()')
  await sleep(1500)
} catch (error) { report.passed = false; report.error = error.message; process.exitCode = 1 }
finally {
  ws?.close()
  if (child.exitCode === null) { child.kill(); try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* own process already gone */ } }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
