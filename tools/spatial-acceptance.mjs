/** Focused post-capture regression on disposable, already-qualified mission data. */
import {spawn} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {basename,join,resolve} from 'node:path'
import WebSocket from 'ws'
const [executable,receiptFile,out]=process.argv.slice(2)
const fixture=JSON.parse(readFileSync(receiptFile,'utf8'))
if(!basename(fixture.dataDir).startsWith('hydra-product-evidence-'))throw Error('Disposable fixture required')
const child=spawn(resolve(executable),['--remote-debugging-port=9374'],{env:{...process.env,HYDRA_DATA_DIR:fixture.dataDir},stdio:'ignore',windowsHide:true})
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),report={passed:false,checks:[],errors:[]}
let ws,send,evaluate
try{
  for(let i=0;i<150&&!ws;i++){try{const p=(await fetch('http://127.0.0.1:9374/json/list').then(r=>r.json())).find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:'));if(p){ws=new WebSocket(p.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)})}}catch{ws=null}if(!ws)await sleep(100)}
  if(!ws)throw Error('Packaged app unavailable')
  let id=0;const pending=new Map();ws.on('message',raw=>{const r=JSON.parse(String(raw));if(pending.has(r.id)){pending.get(r.id)(r);pending.delete(r.id)}})
  send=(method,params={})=>new Promise(r=>{const key=++id;pending.set(key,r);ws.send(JSON.stringify({id:key,method,params}))})
  evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result?.exceptionDetails)throw Error(r.result.exceptionDetails.exception?.description);return r.result?.result?.value}
  const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate('Boolean('+expression+')').catch(()=>false))return;await sleep(100)}throw Error('Timed out: '+expression)}
  const assert=(condition,message)=>{if(!condition)throw Error(message)}
  const shot=async name=>{await sleep(100);writeFileSync(join(out,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'))}
  const click=async text=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>(e.textContent.trim()===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)})&&!e.disabled).click()`);await sleep(150)}
  const home=async()=>{await click('Workspace');await until("Boolean(document.querySelector('#workspace-project'))")}
  const open=async name=>{await home();await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Show all')&&e.textContent.includes('decisions'))?.click()");await evaluate(`[...document.querySelectorAll('.needs-you__row,.mission-preview')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`);await until("Boolean(document.querySelector('.mission-scene'))");await sleep(300)}
  await until("Boolean(document.querySelector('#workspace-project'))")
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:980,deviceScaleFactor:1,mobile:false})
  await open('Repair journey');await until("document.querySelectorAll('.spatial-node--operation').length>0")
  report.checks.push('Flow shows actual recorded operations');await shot('flow-midnight')
  await click('Network');await until("document.querySelector('.spatial-canvas--network')");await shot('network-midnight')
  report.nodes=await evaluate("({operations:document.querySelectorAll('.spatial-node--operation').length,calls:document.querySelectorAll('.spatial-node--tool').length,tabStops:document.querySelectorAll('.spatial-node[tabindex=\"0\"]').length})")
  assert(report.nodes.tabStops===1,'Map creates excessive tab stops');report.checks.push('Roving node tab stop')
  const anchored=await evaluate("(()=>{const n=document.querySelector('.spatial-node--operation'),p=n.querySelector('.spatial-node__point'),a=p.getBoundingClientRect();n.focus();const b=p.getBoundingClientRect();return Math.abs(a.x-b.x)<.5&&Math.abs(a.y-b.y)<.5})()")
  assert(anchored,'Label reveal moved the graph point');report.checks.push('Label focus preserves point coordinates')
  const before=await evaluate("document.querySelector('.spatial-world').style.transform");await click('Zoom in');assert(before!==await evaluate("document.querySelector('.spatial-world').style.transform"),'Zoom did not change framing');await click('Fit and reset canvas');report.checks.push('Zoom and fit')
  await evaluate("document.querySelector('.spatial-node--station.spatial-node--review').focus()")
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});assert(await evaluate("document.activeElement?.dataset.spatialId!=='station:review'&&document.activeElement?.classList.contains('spatial-node')"),'Arrow node navigation failed');report.checks.push('Keyboard node navigation')
  await evaluate("(()=>{const el=document.querySelector('input[aria-label=\"Search displayed scene\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'review');el.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await until("document.querySelector('.spatial-search')");await shot('search');await click('Clear search');report.checks.push('Search displayed scene')
  await evaluate("document.querySelector('.spatial-node--station.spatial-node--review').click()")
  assert(await evaluate("document.querySelector('#mission-focus h3').textContent==='Review'"),'Node did not inspect review');report.checks.push('Node evidence inspection')
  await click('Replay records');assert(await evaluate("document.querySelector('.mission-historical').textContent.includes('Current summaries, output and decisions are hidden')"),'Replay leaks current artifacts');await shot('network-replay');await click('Return to latest');report.checks.push('Replay isolation')
  for(const theme of ['Light','Terracotta']){await click('Settings');await click(theme);await open('Repair journey');await shot('flow-'+theme.toLowerCase());await click('Network');await shot('network-'+theme.toLowerCase())}
  report.checks.push('Three-theme Flow and Network renders')
  await click('Settings');await click('Midnight');await open('Repair journey')
  for(const [width,height] of [[900,760],[390,844]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});assert(await evaluate("document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight+1"),'Outer page overflow');assert(await evaluate("document.querySelector('.spatial-caption').getBoundingClientRect().top>=document.querySelector('.spatial-viewport').getBoundingClientRect().bottom-1"),'Caption covers graph nodes');await shot('flow-'+width)}
  await evaluate("document.querySelector('.spatial-node--station.spatial-node--plan').click()");await until("document.activeElement?.id==='mission-focus'");await click('Back to canvas');await until("document.activeElement?.classList.contains('spatial-node')");report.checks.push('Narrow inspector reveal, return and no outer overflow')
  await send('Emulation.setDeviceMetricsOverride',{width:1500,height:980,deviceScaleFactor:1,mobile:false});await open('Failing check');assert(await evaluate("[...document.querySelectorAll('.decision button')].some(e=>e.disabled&&e.textContent.includes('Acceptance blocked'))"),'Failed-check decision no longer blocked');report.checks.push('Existing failed-check approval remains blocked')
  report.passed=true
}catch(error){report.errors.push(String(error));process.exitCode=1}
finally{if(evaluate)await evaluate('window.close()').catch(()=>{});await sleep(1200);ws?.close();if(child.exitCode===null)child.kill();writeFileSync(join(out,'spatial-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
