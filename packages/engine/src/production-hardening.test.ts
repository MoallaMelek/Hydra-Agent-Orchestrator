import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Task } from '@hydra/protocol'
import { Engine } from './engine.js'
import { AdapterRegistry } from './agents/registry.js'
import { ScriptedAdapter, type ScriptHandler } from './agents/scripted.js'
import { runJsonlProcess } from './agents/jsonl-process.js'
import { InstanceLock, killOrphanAgent } from './process/instance.js'
import { git } from './isolation/git.js'
import { cleanup, makeRepo, tempDir, gitIn, BUGGY_NODE_PROJECT, FIXED_MATH } from './testing/fixtures.js'

const dirs: string[] = [], engines: Engine[] = []
afterEach(async () => { for(const e of engines.splice(0))await e.close().catch(()=>{}); cleanup(...dirs.splice(0)) })
const key='sk-ant-api03-THISISADISPOSABLEFAKESECRET12345678'
async function open(handler: ScriptHandler) {
  const dataDir=tempDir('hydra-production-test-'),repo=makeRepo(BUGGY_NODE_PROJECT);dirs.push(dataDir,repo)
  const engine=await Engine.open({dataDir,skipProbe:true,registry:new AdapterRegistry([new ScriptedAdapter(handler)])});engines.push(engine)
  const project=await engine.execute({type:'project.add',root:repo});if(!project.ok)throw Error(project.error.message)
  return {engine,dataDir,repo,projectId:(project.result as {id:string}).id}
}
async function task(engine:Engine, projectId:string, intent='analyze') {
 const ack=await engine.execute({type:'task.create',projectId,prompt:'Fix arithmetic in the disposable fixture.',intent,mode:'developer',assignment:{planner:'scripted',implementer:'scripted',reviewer:'scripted'},budget:{maxFixRounds:0}})
 if(!ack.ok)throw Error(ack.error.message);const id=(ack.result as Task).id
 await engine.orchestrator.settled(id)
 if(engine.store.getTask(id)?.waitReason==='plan_approval') {
   const approved=await engine.execute({type:'task.approve_plan',taskId:id,approve:true});if(!approved.ok)throw Error(approved.error.message)
   await engine.orchestrator.settled(id)
 }
 return engine.store.getTask(id)!
}
describe('provider privacy and output boundaries',()=>{
 it('redacts structured plan/review and terminal errors before projections, journals and export',async()=>{
  const {engine,projectId}=await open(req=> req.role==='planner'?{structured:{summary:key,steps:['token=abcdefghijk123'],acceptanceCriteria:['passes'],risks:[],filesLikelyTouched:['math.js']}}:req.role==='implementer'?{files:{'math.js':FIXED_MATH},structured:{summary:'done',followUps:[]}}:{structured:{verdict:'approve',summary:key,findings:[],acceptanceCriteriaMet:[]}})
  const t=await task(engine,projectId,'change')
  expect(t.status,t.error ?? 'change did not reach review').toBe('waiting_input')
  expect(t.plan?.summary).toContain('[redacted');expect(t.review?.summary).toContain('[redacted')
  expect(JSON.stringify(engine.store.eventsAfter(0,10000))).not.toContain(key)
  expect(readFileSync(engine.exportData(),'utf8')).not.toContain(key)
  const failed=await open(()=>({fail:key}));const f=await task(failed.engine,failed.projectId)
  expect(f.error).not.toContain(key);expect(JSON.stringify(failed.engine.store.listRuns(f.id))).not.toContain(key)
 })
 it('fails a too-large streamed answer without claiming a completed answer',async()=>{
  const {engine,projectId}=await open(()=>({text:'x'.repeat(1_000_001),chunkSize:100000}))
  const t=await task(engine,projectId)
  expect(t.status).toBe('failed');expect(t.error).toContain('reply limit');expect(t.answer).toBeNull()
 })
 it('bounds a translated event burst and emits one truthful terminal failure',async()=>{
  const events=[]
  for await(const event of runJsonlProcess({executable:process.execPath,args:['-e','console.log(JSON.stringify({burst:true}))'],cwd:process.cwd(),env:process.env,stdin:'',timeoutMs:10000,translate:()=>Array.from({length:1200},()=>({type:'text' as const,text:'x'.repeat(4096)})),conclude:()=>({status:'succeeded',detail:null})},new AbortController().signal))events.push(event)
  const end=events.filter(e=>e.type==='finished');expect(end).toHaveLength(1);expect(end[0]).toMatchObject({status:'failed',detail:expect.stringContaining('bounded event queue')});expect(events.length).toBeLessThan(1030)
 })
})
describe('engine ownership',()=>{
 it('refuses a second OS-held lease even with a corrupt marker',()=>{
  const dir=tempDir('hydra-lease-');dirs.push(dir);writeFileSync(join(dir,'engine.lock'),'broken')
  const first=new InstanceLock(dir),second=new InstanceLock(dir)
  try{first.acquire();expect(()=>second.acquire()).toThrow(/Another Hydra/)}finally{first.release();second.release()}
  second.acquire();second.release()
 })
 it('serializes simultaneous stale-lock takeover by two real processes',async()=>{
  const dir=tempDir('hydra-lease-race-');dirs.push(dir);writeFileSync(join(dir,'engine.lock'),'broken')
  const script=join(dir,'race.mjs'),module=pathToFileURL(join(__dirname,'../dist/process/instance.js')).href
  writeFileSync(script,`import {InstanceLock} from ${JSON.stringify(module)};const lock=new InstanceLock(process.argv[2]);process.on('message',m=>{if(m==='go'){try{lock.acquire();process.send('acquired')}catch{process.send('denied')}}else{lock.release();process.exit(0)}});process.send('ready')`)
  const children:ChildProcess[]=[0,1].map(()=>spawn(process.execPath,[script,dir],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true}))
  const receive=(c:ChildProcess)=>new Promise<string>((resolve,reject)=>{c.once('message',v=>resolve(String(v)));c.once('error',reject);c.once('exit',code=>{if(code)reject(Error('child failed'))})})
  try{await Promise.all(children.map(receive));const results=children.map(receive);children.forEach(c=>c.send('go'));expect((await Promise.all(results)).sort()).toEqual(['acquired','denied'])}finally{for(const c of children){c.send('stop');await new Promise<void>(resolve=>c.once('exit',()=>resolve()))}}
 })
 it('does not terminate historical PIDs whose ownership cannot be proven',async()=>{expect(await killOrphanAgent(process.pid)).toBe(false);expect(()=>process.kill(process.pid,0)).not.toThrow()})
})
describe('configured Git execution',()=>{
 it.each(['clean','smudge','process'])('never launches a configured %s filter',async kind=>{
  const repo=makeRepo({'file.txt':'hello'});dirs.push(repo)
  writeFileSync(join(repo,'file.txt'),'changed content requiring conversion')
  writeFileSync(join(repo,'sentinel.cjs'),"require('fs').writeFileSync('FILTER_RAN','bad');process.stdin.pipe(process.stdout)")
  gitIn(repo,'config',`filter.fixture.${kind}`,'node sentinel.cjs')
  writeFileSync(join(repo,'.gitattributes'),'*.txt filter=fixture\n')
  await expect(git(repo,['add','-A'])).rejects.toThrow();expect(existsSync(join(repo,'FILTER_RAN'))).toBe(false)
 })
 it('refuses external merge-driver configuration before merge',async()=>{const repo=makeRepo({'a':'a'});dirs.push(repo);gitIn(repo,'config','merge.fixture.driver','node sentinel.cjs');await expect(git(repo,['merge','--ff-only','HEAD'])).rejects.toThrow(/external Git merge/)} )
})
describe('retention, backup and indexed search',()=>{
 it('purges task content while retaining content-free acceptance idempotence and remote deduplication',async()=>{
  const {engine,projectId}=await open(()=>({text:'private disposal example'}));const t=await task(engine,projectId)
  engine.store.audit('desktop','task.acceptance',{taskId:t.id,decisionId:'prior-decision',snapshot:'private disposal example'})
  engine.store.rememberRemoteCommand('device','command',{ok:true,result:t})
  expect(await engine.execute({type:'task.purge',taskId:t.id,confirm:'PURGE'},{kind:'remote',deviceId:'device',scopes:['approve']})).toMatchObject({ok:false})
  expect(await engine.execute({type:'task.purge',taskId:t.id,confirm:'PURGE'})).toMatchObject({ok:true})
  expect(engine.store.getTask(t.id)).toBeNull();expect(JSON.stringify(engine.store.eventsAfter(0,10000))).not.toContain('private disposal example')
  expect(JSON.stringify(engine.store.listAudit())).not.toContain('private disposal example');expect(engine.store.hasAcceptanceDecision('prior-decision')).toBe(true)
  expect(engine.store.recallRemoteCommand('device','command')).toEqual({ok:true,result:null})
  expect(engine.store.taskHistory({projectId,query:'private disposal',archived:false}).tasks).toHaveLength(0)
 })
 it('round-trips a consistent backup into a separate profile and preserves read-back data',async()=>{
  const {engine,projectId}=await open(()=>({text:'restore fixture'}));const t=await task(engine,projectId)
  expect(await engine.execute({type:'data.verify_backup'})).toMatchObject({ok:true,result:{integrity:'ok'}})
  const backup=engine.backup();const dir=tempDir('hydra-restored-fixture-');dirs.push(dir);copyFileSync(backup,join(dir,'hydra.db'))
  await engine.close();engines.splice(engines.indexOf(engine),1)
  const restored=await Engine.open({dataDir:dir,skipProbe:true,registry:new AdapterRegistry([new ScriptedAdapter(()=>({text:'unused'}))])});engines.push(restored)
  expect(restored.store.getTask(t.id)?.answer).toBe('restore fixture');expect(restored.store.taskHistory({projectId,query:'restore fixt',archived:false}).tasks[0]?.id).toBe(t.id)
 })
 it('updates the substring index when content changes and treats quote/wildcard input literally',async()=>{
  const {engine,projectId}=await open(()=>({text:'alpha needle 100% "quoted"'}));const t=await task(engine,projectId)
  const search=(query:string)=>engine.store.taskHistory({projectId,query,archived:false}).tasks
  expect(search('needle')).toHaveLength(1);expect(search('100% "quoted"')).toHaveLength(1)
  engine.store.putTask({...t,answer:'replacement material'});expect(search('needle')).toHaveLength(0);expect(search('placement')).toHaveLength(1)
 })
 it('keeps replay byte-bounded and resumable without skipping large events',async()=>{
  const {engine,projectId}=await open(()=>({text:'x'.repeat(3000)}));await task(engine,projectId)
  const all=engine.store.eventsAfter(0,10000);let cursor=0;const seen:number[]=[]
  for(let i=0;i<1000 && cursor<engine.store.lastSeq;i++){const page=engine.store.eventsAfter(cursor,500,10000);expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(11000);seen.push(...page.map(e=>e.seq));cursor=page.at(-1)!.seq}
  expect(seen).toEqual(all.map(e=>e.seq));expect(()=>engine.store.eventsAfter(0,500,1)).toThrow(/replay limit/)
 })
})
