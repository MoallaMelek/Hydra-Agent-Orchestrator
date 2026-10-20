/** Supplemental real-time UI test. Simulated lab transport, never real provider work. */
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve, extname, sep } from 'node:path'
import { tmpdir } from 'node:os'
const out=resolve(process.argv[2]),root=resolve('packages/ui/.lab-dist')
mkdirSync(out,{recursive:true})
app.setPath('userData',mkdtempSync(join(tmpdir(),'hydra-experience-live-')))
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
app.whenReady().then(async()=>{
  const server=createServer((request,response)=>{
    const path=resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname))
    if(!path.startsWith(root+sep)||!existsSync(path)){response.writeHead(404);response.end();return}
    response.writeHead(200,{'Content-Type':{'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'}[extname(path)]??'application/octet-stream'});response.end(readFileSync(path))
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const window=new BrowserWindow({width:1360,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  const report={scope:'SIMULATED FIXTURE transport exercising real-time React/store updates in Electron; no provider or real engine execution',states:[],errors:[]}
  window.webContents.on('console-message',(_event,...args)=>{if(String(args).includes('Uncaught'))report.errors.push(String(args))})
  try{
    await window.loadURL(`http://127.0.0.1:${server.address().port}/lab.html?scenario=failed-review&speed=3`)
    const started=Date.now()
    const seen=new Set()
    while(Date.now()-started<60000){
      const state=await window.webContents.executeJavaScript(`(() => {
        const stations=[...document.querySelectorAll('.mission-station')];
        const active=stations.filter(e=>e.classList.contains('mission-station--running')).map(e=>e.querySelector('strong').textContent);
        const phase=document.querySelector('.mission-scene__bar p')?.textContent??'';
        return {nodes:stations.length,active,phase,fixture:document.querySelector('.lab-banner')?.textContent,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`)
      if(state.nodes){
        if(!state.fixture?.includes('SIMULATED FIXTURE'))throw Error('Fixture label missing')
        if(state.nodes!==6||state.overflow)throw Error('Scene bounds failed')
        const key=state.active.join(',')||(/decision|Waiting for you/i.test(state.phase)?'Decision':'')
        if(key&&!seen.has(key)){seen.add(key);const name='live-'+key.replace(/[^a-z0-9]+/gi,'-').toLowerCase();writeFileSync(join(out,name+'.png'),(await window.webContents.capturePage()).toPNG());report.states.push({...state,file:name+'.png'})}
        if(seen.has('Decision'))break
      }
      await sleep(100)
    }
    for(const expected of ['Plan','Build','Review','Repair','Engine checks','Decision'])if(!seen.has(expected))throw Error('Live fixture state not observed: '+expected)
    report.passed=report.errors.length===0
  }catch(error){report.passed=false;report.error=String(error);process.exitCode=1}
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));window.destroy();await new Promise(r=>server.close(r));app.quit()
})
