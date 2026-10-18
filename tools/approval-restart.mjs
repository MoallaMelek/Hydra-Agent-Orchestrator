/** Restart/history proof against ONLY the disposable product acceptance profile. */
import { spawn } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import WebSocket from 'ws'

const [exe, fixtureFile, destination] = process.argv.slice(2)
const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'))
if (!basename(fixture.dataDir).startsWith('hydra-product-evidence-')) throw new Error('Disposable fixture required')
mkdirSync(destination, { recursive: true })
const report = { passed: false, checks: [], errors: [] }
const child = spawn(resolve(exe), ['--remote-debugging-port=9371'], { env: { ...process.env, HYDRA_DATA_DIR: fixture.dataDir }, stdio: 'ignore', windowsHide: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let ws, evaluate
try {
  for (let i = 0; i < 200 && !ws; i++) {
    try {
      const tabs = await fetch('http://127.0.0.1:9371/json/list').then(r => r.json())
      const tab = tabs.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1:'))
      if (tab) { ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise((ok, fail) => { ws.once('open', ok); ws.once('error', fail) }) }
    } catch { ws = null }
    if (!ws) await sleep(150)
  }
  if (!ws) throw new Error('Restarted packaged app did not open')
  let id = 0; const pending = new Map()
  ws.on('message', raw => { const m = JSON.parse(String(raw)); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  const send = (method, params = {}) => new Promise(resolve => { const key = ++id; pending.set(key, resolve); ws.send(JSON.stringify({ id: key, method, params })) })
  evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text); return r.result?.result?.value }
  for (let i = 0; i < 200; i++) { if (await evaluate('Boolean(window.hydraHost && document.querySelector(".nav-item"))')) break; await sleep(100) }
  const taskId = fixture.fixtures.find(f => f.name === 'Passing check').taskId
  const task = await evaluate(`fetch(window.hydraHost.apiUrl+'/api/tasks/'+${JSON.stringify(taskId)},{headers:{Authorization:'Bearer '+window.hydraHost.token}}).then(r=>r.json()).then(d=>d.task)`)
  if (task.outcome !== 'rolled_back' || !task.acceptance?.decisionId || task.acceptance.unresolved.length) throw new Error('Acceptance/revert history did not persist across restart')
  const failedId = fixture.fixtures.find(f => f.name === 'Failing check').taskId
  const failed = await evaluate(`fetch(window.hydraHost.apiUrl+'/api/tasks/'+${JSON.stringify(failedId)},{headers:{Authorization:'Bearer '+window.hydraHost.token}}).then(r=>r.json()).then(d=>d.task)`)
  if (failed.outcome !== null || failed.status !== 'waiting_input') throw new Error('Denied task changed during restart')
  await evaluate("[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim().startsWith('Passing check')).click()")
  await sleep(500)
  const screen = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(destination, 'restarted-history.png'), Buffer.from(screen.result.data, 'base64'))
  report.checks.push('packaged restart', 'acceptance receipt persisted', 'revert history persisted', 'blocked task stays unapplied')
  report.decisionId = task.acceptance.decisionId
  report.passed = true
} catch (e) { report.errors.push(e.message); process.exitCode = 1 }
finally {
  if (evaluate) await evaluate('window.close()').catch(() => {})
  await sleep(1500); ws?.close()
  if (child.exitCode === null) child.kill()
  writeFileSync(join(destination, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
