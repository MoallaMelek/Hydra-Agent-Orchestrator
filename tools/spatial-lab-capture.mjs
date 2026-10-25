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
    await window.loadURL(`http://127.0.0.1:${server.address().port}/lab.html?scenario=spatial`)
    window.showInactive()
    await sleep(2000)
    await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Network').click()")
    await sleep(500)
    await window.webContents.executeJavaScript("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
    const detail=await window.webContents.executeJavaScript("({nodes:document.querySelectorAll('.spatial-node').length,calls:document.querySelectorAll('.spatial-node--tool').length,fixture:document.querySelector('.lab-banner').textContent,overflow:document.documentElement.scrollWidth>innerWidth})")
    if(detail.calls!==190||detail.overflow||!detail.fixture.includes('SIMULATED FIXTURE'))throw Error('Density fixture bounds failed: '+JSON.stringify(detail))
    await window.webContents.executeJavaScript("(()=>{const main=document.querySelector('.main'),scene=document.querySelector('.mission-scene');main.scrollTo({top:main.scrollTop+scene.getBoundingClientRect().top-main.getBoundingClientRect().top-12})})()")
    await sleep(250)
    await window.webContents.debugger.attach('1.3')
    const shot=await window.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png'})
    writeFileSync(join(out,'network-density-SIMULATED.png'),Buffer.from(shot.data,'base64'))
    await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Flow').click()")
    await sleep(250);const flow=await window.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'flow-density-SIMULATED.png'),Buffer.from(flow.data,'base64'))
    report.detail=detail;report.passed=true
  }catch(error){report.passed=false;report.error=String(error);process.exitCode=1}
  writeFileSync(join(out,'density-report.json'),JSON.stringify(report,null,2));window.destroy();await new Promise(r=>server.close(r));app.quit()
})
