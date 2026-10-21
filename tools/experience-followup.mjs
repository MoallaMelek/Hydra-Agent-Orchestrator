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
  const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression).catch(()=>false))return;await sleep(100)}throw Error('Timed out: '+expression)}
  const assert=(condition,message)=>{if(!condition)throw Error(message)}
  const shot=async name=>{await sleep(100);writeFileSync(join(out,name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'))}
  const click=async text=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled).click()`);await sleep(150)}
  const home=async()=>{await click('Workspace');await until("Boolean(document.querySelector('#workspace-project'))")}
  const open=async name=>{await home();await evaluate(`[...document.querySelectorAll('.needs-you__row,.mission-preview')].find(e=>e.textContent.includes(${JSON.stringify(name)})).click()`);await until("Boolean(document.querySelector('.mission-scene'))");await sleep(300)}
  await until("Boolean(document.querySelector('#workspace-project'))")
  await send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
  await open('Repair journey');await evaluate("document.querySelector('.spatial-node--station.spatial-node--review').click()")
  await evaluate("(()=>{const s=document.querySelector('select[aria-label=\"Select recorded operation\"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,s.options[0].value);s.dispatchEvent(new Event('change',{bubbles:true}))})()")
  await until("document.querySelector('.mission-focus__finding').textContent.includes('Earlier or incomplete')");report.checks.push('Earlier review does not inherit current approval summary');await shot('earlier-review-no-current-summary')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
  await evaluate("document.querySelector('.spatial-node--station.spatial-node--plan').click()")
  await until("document.activeElement?.id==='mission-focus'")
  assert(await evaluate("document.documentElement.scrollTop===0&&document.querySelector('.rail').getBoundingClientRect().top>=0"),'Inspector navigation clipped the command frame');await shot('narrow-inspector-focus');await click('Back to canvas')
  await until("document.activeElement?.classList.contains('spatial-node--station')");report.checks.push('Narrow inspector reveal and return preserve command frame')
  await send('Emulation.setDeviceMetricsOverride',{width:1360,height:900,deviceScaleFactor:1,mobile:false})
  await open('Passing check');await click('Open mission details');await until("document.activeElement?.id==='task-inspector'")
  assert(await evaluate("document.documentElement.scrollTop===0&&document.querySelector('.rail').getBoundingClientRect().top>=0"),'Deep link clipped command frame');report.checks.push('Mission deep link scrolls only the owned workspace')
  assert(await evaluate("[...document.querySelectorAll('#task-inspector .md strong')].some(e=>e.textContent.includes('Scripted review fixture'))&&!document.querySelector('#task-inspector').innerText.includes('**Scripted review fixture.**')"),'Raw Markdown remains in dossier summary');report.checks.push('Plan/review dossier summaries use safe Markdown')
  await evaluate("(()=>{const main=document.querySelector('.main'),receipt=document.querySelector('.mission-receipt');main.scrollTo({top:main.scrollTop+receipt.getBoundingClientRect().top-main.getBoundingClientRect().top-20})})()")
  await shot('delivery-history');report.checks.push('Persisted acceptance and revert receipt captured')
  report.passed=true
}catch(error){report.errors.push(String(error));process.exitCode=1}
finally{if(evaluate)await evaluate('window.close()').catch(()=>{});await sleep(1200);ws?.close();if(child.exitCode===null)child.kill();writeFileSync(join(out,'followup-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
