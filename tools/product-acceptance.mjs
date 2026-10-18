import { approvalContext } from '@hydra/protocol'
/** Packaged Electron acceptance. Only operates on disposable seed-product-evidence profiles. */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import WebSocket from 'ws'

const [executable, seedFile, destination] = process.argv.slice(2)
if (!executable || !seedFile || !destination) throw new Error('Supply packaged executable, fixture receipt and evidence output directory')
const seed = JSON.parse(readFileSync(seedFile, 'utf8'))
if (!basename(seed.dataDir).startsWith('hydra-product-evidence-')) throw new Error('Disposable product evidence profile required')
const out = resolve(destination); mkdirSync(out, { recursive: true })
mkdirSync(join(seed.dataDir, 'desktop'), { recursive: true })
writeFileSync(join(seed.dataDir, 'desktop', 'updates.json'), JSON.stringify({ autoCheck: false, autoDownload: false }))
const report = { fixture: seed.agentSource, executable: resolve(executable), executableSha256: createHash('sha256').update(readFileSync(executable)).digest('hex'), steps: [], screenshots: [], errors: [] }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const port = 9369
const child = spawn(resolve(executable), [`--remote-debugging-port=${port}`, `--user-data-dir=${join(seed.dataDir, 'electron-product')}`], { env: { ...process.env, HYDRA_DATA_DIR: seed.dataDir }, stdio: 'ignore', windowsHide: true })
let ws, evaluate, send
const assert = (ok, message) => { if (!ok) throw new Error(message) }
async function wait(expression) { for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return; await sleep(100) } throw new Error('Timed out: ' + expression) }
async function click(text) { await evaluate(`(() => { const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)} && !e.disabled); if(!el) throw new Error('Missing enabled button '+${JSON.stringify(text)}); el.click(); })()`); await sleep(200) }
async function shot(name) { await sleep(180); const r=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,name+'.png'),Buffer.from(r.result.data,'base64')); report.screenshots.push(name+'.png') }
async function step(name, fn) { const result=await fn(); report.steps.push({name,result:'PASS',detail:result}); console.log('PASS '+name) }
const api = (path, body) => evaluate(`fetch(window.hydraHost.apiUrl+${JSON.stringify(path)}, {method:${body ? '"POST"' : '"GET"'},headers:{Authorization:'Bearer '+window.hydraHost.token,'Content-Type':'application/json'},${body ? 'body:'+JSON.stringify(JSON.stringify(body)) : ''}}).then(r=>r.json())`)
async function home() { await evaluate("[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim()==='Workspace').click()"); await wait("document.querySelector('#workspace-project')") }
async function openTask(name) { await home(); if (!await evaluate(`[...document.querySelectorAll('.needs-you__row')].some(e=>e.textContent.includes(${JSON.stringify(name)}))`)) await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Show all') && e.textContent.includes('decisions'))?.click()"); await evaluate(`[...document.querySelectorAll('.needs-you__row')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`); await wait("document.querySelector('.mission-receipt')"); await sleep(350) }
async function geometry() { return evaluate(`({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth, outerScroll:document.documentElement.scrollHeight>document.documentElement.clientHeight+1, width:innerWidth, height:innerHeight})`) }
try {
  assert(existsSync(executable), 'Package missing')
  for (let i=0;i<200 && !ws;i++) { try { const pages=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json()); const page=pages.find(p=>p.type==='page' && p.url.startsWith('http://127.0.0.1:')); if(page) { ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)}) } } catch {ws=null} if(!ws) await sleep(100) }
  assert(ws,'Packaged Electron did not open')
  let id=0;const pending=new Map()
  ws.on('message',raw=>{const r=JSON.parse(String(raw));if(pending.has(r.id)){pending.get(r.id)(r);pending.delete(r.id)}if(r.method==='Runtime.exceptionThrown') report.errors.push(r.params.exceptionDetails?.exception?.description ?? r.params.exceptionDetails?.text)})
  send=(method,params={})=>new Promise(resolve=>{const key=++id;pending.set(key,resolve);ws.send(JSON.stringify({id:key,method,params}))})
  evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.error||r.result?.exceptionDetails)throw new Error(r.error?.message??r.result.exceptionDetails.exception?.description);return r.result?.result?.value}
  await send('Runtime.enable');await wait('window.hydraHost && document.querySelector("#workspace-project")')
  await step('packaged workspace and three-window reflow',async()=>{
    const results=[]
    for(const [width,height] of [[1360,900],[900,760],[390,844]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await shot('workspace-'+width);const g=await geometry();assert(!g.overflow&&!g.outerScroll,'Workspace overflow '+width);results.push(g)}
    await send('Emulation.clearDeviceMetricsOverride');return results
  })
  await step('accounts, settings and phone access retain a usable hierarchy',async()=>{
    for(const [label,screen] of [['AI accounts','accounts'],['Phone access','phone'],['Settings','settings']]) { await click(label); await shot(screen); assert(!(await geometry()).overflow,label+' overflow') }
    await click('Light'); await shot('settings-light'); await click('Midnight');
    await click('Phone access'); assert((await evaluate('document.body.innerText')).includes('HTTP'),'Remote limitation missing')
  })
  await step('solid text token contrast across all three themes meets 4.5 to 1',async()=>{
    const rows=[]
    for(const theme of ['Midnight','Light','Terracotta']) {
      await click('Settings');await click(theme)
      const pairs=await evaluate(`(() => {
        const css=getComputedStyle(document.documentElement);
        const luminance=value=>{let hex=value.trim().replace('#','');if(hex.length===3)hex=hex.split('').map(c=>c+c).join('');const rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
        return ['--bg','--surface','--surface-2'].flatMap(bg=>['--text','--text-2','--text-3','--accent','--ok','--bad','--you'].map(fg=>{const a=luminance(css.getPropertyValue(bg)),b=luminance(css.getPropertyValue(fg));return {bg,fg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}}));
      })()`)
      for(const p of pairs) assert(Number.isFinite(p.ratio)&&p.ratio>=4.5,theme+' contrast '+JSON.stringify(p))
      rows.push({theme,pairs})
    }
    await click('Midnight');return {rows,scope:'63 solid token pairs; excludes alpha/disabled/native/syntax states and is not accessibility certification'}
  })
  await step('passing, failed and absent evidence are distinct at final approval',async()=>{
    for(const [name,state] of [['Passing check','Checks passed'],['Failing check','Checks failed'],['No checks','Unverified']]) {
      await openTask(name); const text=await evaluate('document.body.innerText');assert(text.includes(state),'Wrong evidence label for '+name)
      const accept=await evaluate("[...document.querySelectorAll('.decision button')].find(e=>e.textContent.includes('Accept'))?.disabled")
      assert(accept===(name!=='Passing check'),'Wrong default acceptance state')
      await shot('receipt-'+name.toLowerCase().replaceAll(' ','-'))
      await click('Settings');await click('Light');await openTask(name);await shot('receipt-light-'+name.toLowerCase().replaceAll(' ','-'));await click('Settings');await click('Midnight')
    }
  })
  await step('blocked acceptance and request-changes dialog are keyboard accessible',async()=>{
    await openTask('Failing check')
    assert(await evaluate("[...document.querySelectorAll('.decision button')].find(e=>e.textContent.includes('Acceptance blocked')).disabled"),'Failed evidence was not blocked')
    await click('Request changes');await wait('document.querySelector("dialog[open]")')
    const dialog=await evaluate("({label:document.querySelector('dialog[open]').getAttribute('aria-labelledby'),focus:document.activeElement?.id})")
    assert(dialog.label && dialog.focus==='feedback','Dialog has no accessible title/focus')
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await sleep(150)
    assert(!await evaluate("document.querySelector('dialog[open]')"),'Escape did not close dialog')
    return dialog
  })
  await step('recorded proof opens its actual evidence inspector',async()=>{
    await openTask('Passing check');await evaluate("[...document.querySelectorAll('.proofline button')].find(e=>e.textContent.includes('Checks recorded')).click()");await sleep(200)
    assert(await evaluate("document.activeElement?.id==='task-inspector'"),'Proof inspector focus missing')
    assert(await evaluate("document.querySelector('[role=tab][aria-selected=true]').textContent.includes('Checks')"),'Proof selected wrong inspector')
    await shot('proof-inspector')
  })
  await step('operations are opt-in; tabs support arrow navigation; reduced motion and narrow receipts work',async()=>{
    await openTask('Passing check');assert(!await evaluate("document.querySelector('.ops-grid')"),'Operations mounted while collapsed')
    await evaluate("document.querySelector('.work-details').open=true");await wait("document.querySelector('.ops-grid')");await shot('operations-disclosed')
    await evaluate("document.querySelector('.work-details').open=false")
    await evaluate("document.querySelector('[role=tab]').focus()")
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await sleep(150)
    assert((await evaluate("document.activeElement.textContent")).includes('Changes'),'Arrow tab navigation failed')
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await sleep(150)
    assert(await evaluate("document.documentElement.dataset.quality!=='full'"),'Reduced motion ignored')
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await shot('receipt-390');assert(!(await geometry()).overflow,'Receipt overflow')
    await send('Emulation.clearDeviceMetricsOverride');await send('Emulation.setEmulatedMedia',{features:[]})
  })
  await step('engine refuses failed, missing, stale, untrusted and rejected-review decisions through HTTP',async()=>{
    const results=[]
    for(const name of ['Failing check','No checks','Reviewer objections','Stale evidence','Missing result','Untrusted evidence','Changed command','Changed definitions','Stale review']) {
      await openTask(name)
      assert(await evaluate("[...document.querySelectorAll('.decision button')].find(e=>e.textContent.includes('Acceptance blocked'))?.disabled"),name+' was not blocked in UI')
      const taskId=seed.fixtures.find(f=>f.name===name).taskId
      const detail=await api('/api/tasks/'+taskId)
      const command={type:'task.decide',taskId,decision:'accept',headSha:detail.task.workspace.headSha,acceptance:{decisionId:crypto.randomUUID(),snapshot:approvalContext(detail.task,detail.evidence).snapshot}}
      const denied=await api('/api/commands',command)
      assert(!denied.ok && denied.error.code==='conflict',name+' accepted by engine')
      const exception=await api('/api/commands',{...command,decision:'accept_exception',reason:'test exception'})
      assert(!exception.ok,'Unsupported exception accepted')
      assert((await api('/api/tasks/'+taskId)).task.outcome===null,'Blocked task changed outcome')
      if (['Changed command','Changed definitions'].includes(name)) assert(await evaluate("[...document.querySelectorAll('.proofline button')].find(e=>e.textContent.includes('Checks recorded')).textContent.includes('untrusted')"),'Stale check proof appears trusted')
      if (name==='Stale review') assert(await evaluate("[...document.querySelectorAll('.proofline button')].find(e=>e.textContent.includes('Review recorded')).textContent.includes('Stale')"),'Stale review appears approved')
      await shot('blocked-'+name.toLowerCase().replaceAll(' ','-'));results.push({name,denied:denied.error.code,exception:exception.error.code})
    }
    return results
  })
  await step('real fixture apply and revert preserve Git history',async()=>{
    await openTask('Passing check');await click('Accept')
    const taskId=seed.fixtures.find(f=>f.name==='Passing check').taskId
    for(let i=0;i<200;i++){const d=await api('/api/tasks/'+taskId);if(d.task.outcome==='applied')break;await sleep(100)}
    const applied=(await api('/api/tasks/'+taskId)).task
    assert(applied.outcome==='applied' && applied.acceptance?.unresolved.length===0,'Fixture was not applied with a receipt')
    await wait("document.body.innerText.includes('Accepted with passing checks and reviewer approval')");await shot('accepted-receipt')
    const duplicate=await api('/api/commands',{type:'task.decide',taskId,decision:'accept',headSha:applied.acceptance.revision,acceptance:{decisionId:applied.acceptance.decisionId,snapshot:applied.acceptance.snapshot}})
    assert(!duplicate.ok,'Duplicate acceptance was allowed')
    await click('Roll back');await wait("document.body.innerText.includes('Rolled back')");await shot('rolled-back')
    const task=(await api('/api/tasks/'+taskId)).task
    assert(task.outcome==='rolled_back' && task.applied.rolledBackSha,'No revert record')
    return {outcome:task.outcome,appliedSha:task.applied.afterSha,revertSha:task.applied.rolledBackSha}
  })
  await step('plan rejection and deletion semantics are visible without running a provider',async()=>{
    await openTask('Plan approval');await shot('plan-approval');await click('Reject');await wait("document.body.innerText.includes('Discarded')")
    await click('Delete');await wait("document.querySelector('dialog[open]')")
    assert((await evaluate('document.body.innerText')).includes('not secure erasure'),'Deletion retention warning absent');await shot('deletion-contract');await click('Cancel')
    await click('Delete');await evaluate("document.querySelector('.purge-controls').open=true")
    assert(await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Purge stored task content').disabled"),'Purge confirmation guard absent')
    await evaluate("(()=>{const input=document.querySelector('#purge-task');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'PURGE');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
    await sleep(200);await shot('purge-confirmation');await click('Purge stored task content');await wait("document.querySelector('.history-search')")
    const state=await api('/api/state');assert(!state.tasks.some(t=>t.id===seed.fixtures.find(f=>f.name==='Plan approval').taskId),'Purged fixture still in state')
  })
  await step('local retention and backup read-back are explicit',async()=>{
    await click('Settings');await click('Inspect local retention');await wait("document.body.innerText.includes('journal records')");await click('Create and verify backup');await wait("document.body.innerText.includes('integrity')");await shot('verified-backup')
  })
  await step('project history uses server summaries and the check editor still opens',async()=>{
    await evaluate("[...document.querySelectorAll('.nav-item')].find(e=>e.textContent.trim().startsWith('Failing check')).click()")
    await wait("document.querySelector('.history-search')");await shot('project-history')
    const project=(await api('/api/state')).projects.find(p=>p.name==='Failing check')
    const history=await api('/api/history',{projectId:project.id,query:'TEST FIXTURE',archived:false})
    assert(history.tasks.length===1 && !('prompt' in history.tasks[0]),'History is not a summary page')
    await evaluate("document.querySelector('details.disclosure').open=true");await shot('project-checks')
  })
  await step('idle renderer has no continuing operations clock',async()=>{
    await home();await send('Performance.enable')
    await sleep(2000)
    const metrics=async()=>Object.fromEntries((await send('Performance.getMetrics')).result.metrics.map(m=>[m.name,m.value]))
    const start=await metrics();await sleep(10_000);const end=await metrics()
    return {windowSeconds:10,rendererTaskSeconds:end.TaskDuration-start.TaskDuration,scope:'short renderer sample only; no whole-process CPU or soak qualification'}
  })
  assert(!report.errors.length,'Renderer exceptions observed')
  report.passed=true
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;console.log('FAIL '+error.message);if(send)await shot('failure').catch(()=>{})}
finally{if(evaluate)await evaluate('window.close()').catch(()=>{});await sleep(1500);ws?.close();if(child.exitCode===null){child.kill();try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'})}catch{/* own process ended */}}writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,steps:report.steps.length,error:report.error,out},null,2))}
