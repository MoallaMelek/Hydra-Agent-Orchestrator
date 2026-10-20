import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const out = resolve(process.argv[2])
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1360, height: 900, show: false, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const checks = []
  try {
    for (const name of ['mission-control', 'neural-canvas', 'living-workspace']) {
      await window.loadFile(join(out, name+'.html'))
      const result = await window.webContents.executeJavaScript(`(() => {
        if (document.querySelector('#launch')) { document.querySelector('textarea').value='Repair cart quantities'; document.querySelector('#launch').click(); if (!document.querySelector('#launch-result').textContent.includes('Repair cart')) throw Error('Composer failed'); }
        const control=document.querySelector('[data-agent="Reviewer"]') ?? document.querySelector('[data-phase="Review"]');control.click();
        if (!(document.querySelector('#inspect-title') ?? document.querySelector('#phase-title')).textContent.includes(control.dataset.agent ? 'Changes requested' : 'objection')) throw Error('Review inspection failed');
        return { title: document.title, overflow: document.documentElement.scrollWidth>innerWidth, review: true };
      })()`)
      if (result.overflow) throw Error(name+' overflow')
      let screenshot
      for(let attempt=0;attempt<3&&!screenshot;attempt++) {
        await new Promise(resolve=>setTimeout(resolve,150))
        try { screenshot=await window.webContents.capturePage() } catch(error) { if(attempt===2) throw error }
      }
      writeFileSync(join(out,name+'.png'),screenshot.toPNG())
      checks.push({name,...result})
    }
    writeFileSync(join(out,'prototype-results.json'),JSON.stringify({passed:true,engine:process.versions.electron,checks},null,2))
  } catch(error) { writeFileSync(join(out,'prototype-results.json'),JSON.stringify({passed:false,error:String(error),checks},null,2)); process.exitCode=1 }
  window.destroy(); app.quit()
})
