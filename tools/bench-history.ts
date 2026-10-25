/** Disposable local scale evidence. Never opens a personal profile or invokes providers. */
import { mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Task, emptyUsage } from '@hydra/protocol'
import { Store } from '../packages/engine/src/store/store.js'
const dir = mkdtempSync(join(tmpdir(), 'hydra-history-scale-'))
const store = new Store(join(dir, 'hydra.db'))
const rows: unknown[] = []
const began = performance.now()
function sample(fn: () => unknown) { const ms=[]; let value: unknown; for(let i=0;i<15;i++){const start=performance.now();value=fn();ms.push(performance.now()-start)} return {p50ms:ms.sort((a,b)=>a-b)[7],p95ms:ms.at(-1),value} }
try {
  let n=0
  for(const size of [1000,10000,50000]) {
    for(;n<size;) store.transaction(()=>{for(let i=0;i<500 && n<size;i++,n++) {
      const at = new Date(1_700_000_000_000 + n).toISOString()
      const task=Task.parse({id:'t'+String(n).padStart(25,'0'),projectId:'p'.repeat(26),title:`Generated task ${n}`,prompt:`Generated benchmark request ${n}`,intent:'analyze',mode:'safe',assignment:{planner:'claude',implementer:'codex',reviewer:'claude'},budget:{maxCostUsd:2,maxTokens:2000000,maxWallMinutes:30,maxAgentRuns:8,maxFixRounds:1},status:'completed',stage:'plan',outcome:'answered',waitReason:null,fixRound:0,plan:null,review:null,checks:[],checksApproved:false,checkDigest:null,applyIntent:null,demo:null,answer:'Benchmark answer. '.repeat(60),workspace:null,applied:null,usage:emptyUsage(),stages:[],feedback:[],error:null,createdAt:at,updatedAt:at})
      store.putTask(task)
    }})
    const boot=sample(()=>store.initialTasks())
    const history=sample(()=>store.taskHistory({projectId:'p'.repeat(26),query:'',archived:false}))
    const search=sample(()=>store.taskHistory({projectId:'p'.repeat(26),query:`request ${size-1}`,archived:false}))
    rows.push({size,boot:{p50ms:boot.p50ms,p95ms:boot.p95ms,records:(boot.value as unknown[]).length,bytes:Buffer.byteLength(JSON.stringify(boot.value))},history:{p50ms:history.p50ms,p95ms:history.p95ms},search:{p50ms:search.p50ms,p95ms:search.p95ms},rssBytes:process.memoryUsage().rss,databaseBytes:statSync(join(dir,'hydra.db')).size})
  }
  writeFileSync(process.argv[2]!,JSON.stringify({fixture:'Generated disposable tasks; no user records or agents',dataDir:dir,totalMs:performance.now()-began,rows},null,2))
  console.log(JSON.stringify(rows,null,2))
} finally {store.close()}
