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
async function openTask(name) { await home(); if (!await evaluate(`[...document.querySelectorAll('.needs-you__row')].some(e=>e.textContent.includes(${JSON.stringify(name)}))`)) await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Show all') && e.textContent.includes('decisions'))?.click()"); await evaluate(`[...document.querySelectorAll('.needs-you__row')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`); await wait("document.querySelector('.mission-scene')"); await sleep(350) }
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
    await send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false});return results
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
      await openTask(name); await evaluate("document.querySelector('.mission-dossier').open=true"); const text=await evaluate('document.body.innerText');assert(text.includes(state),'Wrong evidence label for '+name)
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
  await step('canvas selects actual checks and focuses their inspector',async()=>{
    await openTask('Passing check');await shot('mission-canvas')
    await evaluate("document.querySelector('.mission-station--checks').click()")
    await shot('selected-checks');await click('Open check evidence')
    assert(await evaluate("document.activeElement?.id==='task-inspector'"),'Evidence inspector focus missing')
    assert(await evaluate("document.querySelector('[role=tab][aria-selected=true]').textContent.includes('Checks')"),'Wrong evidence tab')
  })
  await step('record replay hides current artifacts; narrow themes and reduced motion retain controls',async()=>{
    await openTask('Passing check');await click('Replay records');await shot('historical-replay')
    assert(await evaluate("document.querySelector('.mission-historical').textContent.includes('Historical artifact snapshots are unavailable')"),'Historical snapshots misrepresented')
    assert(!await evaluate("document.querySelector('.mission-focus .inspector')"),'Current artifacts leaked into replay')
    await click('Return to latest')
    for(const theme of ['Midnight','Light','Terracotta']) {
      await click('Settings');await click(theme);await openTask('Passing check')
      await shot('canvas-'+theme.toLowerCase())
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
      await shot('canvas-'+theme.toLowerCase()+'-390');assert(!(await geometry()).overflow,'Narrow scene overflow')
      await send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
    }
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    assert(await evaluate("getComputedStyle(document.querySelector('.mission-station')).transitionDuration==='0s'"),'Reduced motion not honored')
    await send('Emulation.setEmulatedMedia',{features:[]})
    await click('Settings');await click('Minimal');await openTask('Passing check')
    assert(await evaluate("document.querySelectorAll('.mission-station').length===6&&getComputedStyle(document.querySelector('.mission-station')).transitionDuration==='0s'"),'Minimal quality hid evidence or retained motion')
    await shot('minimal-quality');await click('Settings');await click('Auto')
    await click('Settings');await click('Midnight')
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
      if (['Changed command','Changed definitions'].includes(name)) assert(await evaluate("document.querySelector('.mission-station--checks').textContent.match(/untrusted|stale/i)"),'Stale check proof appears trusted')
      if (name==='Stale review') assert(await evaluate("document.querySelector('.mission-station--review').textContent.includes('Stale')"),'Stale review appears approved')
      await shot('blocked-'+name.toLowerCase().replaceAll(' ','-'));results.push({name,denied:denied.error.code,exception:exception.error.code})
    }
    return results
  })
  await step('launch action fits desktop and laptop; native accessibility tree exposes mission controls',async()=>{
    await home()
    const sizes=[]
    for(const [width,height] of [[1360,900],[900,760]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false})
      const bounds=await evaluate("(()=>{const r=document.querySelector('.composer .hx-btn--primary').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight}})()")
      assert(bounds.bottom<=bounds.height,'Launch action below first viewport '+width);sizes.push({width,...bounds})
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
    await openTask('Passing check')
    const tree=(await send('Accessibility.getFullAXTree')).result.nodes.filter(n=>!n.ignored)
    for(const name of ['Plan','Build','Review','Engine checks','Your decision']) assert(tree.some(n=>n.role?.value==='button'&&n.name?.value?.includes(name)),'AX button missing '+name)
    assert(tree.some(n=>n.role?.value==='slider'&&n.name?.value==='Recorded moment'),'Replay slider name absent')
    assert(tree.some(n=>n.role?.value==='main'),'Main landmark absent')
    await send('Page.bringToFront')
    await send('Emulation.setFocusEmulationEnabled',{enabled:true})
    await evaluate("document.querySelector('.mission-station--plan').focus()")
    assert(await evaluate("document.activeElement===document.querySelector('.mission-station--plan')"),'Station did not receive keyboard focus')
    await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13})
    await send('Input.dispatchKeyEvent',{type:'char',text:'\r',unmodifiedText:'\r',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13})
    await wait("document.querySelector('.mission-station--plan').getAttribute('aria-pressed')==='true'")
    return {sizes,exposedNodes:tree.length,scope:'Browser accessibility tree and keyboard checks; not a screen-reader user study'}
  })
  await step('actual recorded repair, handoffs, timeline and failure recovery remain inspectable',async()=>{
    await openTask('Repair journey')
    assert(await evaluate("!document.querySelector('.mission-station--repair').textContent.includes('No record yet')"),'Repair operation absent')
    await evaluate("document.querySelector('.mission-station--repair').click()")
    await shot('repair-journey');await click('Timeline');await shot('agent-timeline');await click('Records');await shot('operation-records')
    await click('Canvas');await evaluate("document.querySelector('.mission-station--review').click()")
    await evaluate("(()=>{const s=document.querySelector('select[aria-label=\"Select recorded operation\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,s.options[0].value);s.dispatchEvent(new Event('change',{bubbles:true}))})()")
    await wait("document.querySelector('.mission-focus__finding').textContent.includes('Earlier or incomplete review operation')");await shot('earlier-review-no-current-summary')
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
    await evaluate("document.querySelector('.mission-station--plan').click()")
    await wait("document.activeElement?.id==='mission-focus'")
    assert(await evaluate("document.querySelector('#mission-focus').getBoundingClientRect().top>=0&&document.querySelector('#mission-focus').getBoundingClientRect().top<innerHeight"),'Narrow evidence inspector was not revealed')
    await shot('narrow-inspector-focus');await click('Back to canvas')
    await wait("document.activeElement?.classList.contains('mission-station')")
    await send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
    await click('Canvas');await click('Replay records');await click('Play records');await sleep(850);await click('Pause replay');await shot('replay-playing-paused');await click('Return to latest')
    await home();await evaluate("[...document.querySelectorAll('.mission-preview')].find(e=>e.textContent.includes('Execution failure')).click()")
    await wait("document.querySelector('.mission-scene')");await shot('execution-failure')
    assert((await evaluate('document.body.innerText')).includes('Deliberate scripted execution failure'),'Failure cause not displayed')
    await openTask('Reviewer objections');await evaluate("document.querySelector('.mission-station--review').click()");await shot('reviewer-finding')
    assert(await evaluate("document.querySelector('.mission-focus').textContent.includes('Deliberate blocking review fixture')"),'Reviewer finding missing')
  })
  await step('real fixture apply and revert preserve Git history',async()=>{
    await openTask('Passing check');await click('Accept')
    const taskId=seed.fixtures.find(f=>f.name==='Passing check').taskId
    for(let i=0;i<200;i++){const d=await api('/api/tasks/'+taskId);if(d.task.outcome==='applied')break;await sleep(100)}
    const applied=(await api('/api/tasks/'+taskId)).task
    assert(applied.outcome==='applied' && applied.acceptance?.unresolved.length===0,'Fixture was not applied with a receipt')
    await evaluate("document.querySelector('.mission-dossier').open=true");await wait("document.body.innerText.includes('Accepted with passing checks and reviewer approval')");await evaluate("document.querySelector('.mission-receipt').scrollIntoView({block:'start'})");await shot('accepted-receipt')
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
