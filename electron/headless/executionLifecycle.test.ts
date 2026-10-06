import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(()=>({spawn:vi.fn(),terminate:vi.fn(async()=>{})}))
vi.mock('../agents/cliExecution',()=>({spawnResolvedCli:mocks.spawn,terminateProcessTree:mocks.terminate,resolveCliExecutable:vi.fn(()=>null),codexTaskIsolationArgs:vi.fn(()=>[])}))
import { HeadlessOrchestrator } from './HeadlessOrchestrator'
const roots:string[]=[]
let child:any
beforeEach(()=>{vi.clearAllMocks();child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),pid:12345,exitCode:null});mocks.spawn.mockReturnValue(child)})
afterEach(()=>{vi.useRealTimers();for(const root of roots.splice(0)){if(!root.startsWith(join(tmpdir(),'hydra-execution-test-')))throw new Error('Invalid cleanup');rmSync(root,{recursive:true,force:true})}})
function fixture(){const root=mkdtempSync(join(tmpdir(),'hydra-execution-test-'));roots.push(root);return new HeadlessOrchestrator(root)}
const payload={projectDir:process.cwd(),prompt:'Untrusted & echo %PATH% $(whoami) `text`',provider:'codex' as const,model:'test-model'}
describe('headless execution lifecycle',()=>{
  it('passes the supported explicit sandbox option and retains deny rules for approved writes',()=>{
    const service=fixture();service.start({...payload,sandbox:'workspace-write',accessMode:'project-write'})
    const args=mocks.spawn.mock.calls[0][1] as string[]
    expect(args[args.indexOf('-s')+1]).toBe('workspace-write')
    expect(args).not.toContain('--ignore-user-config');expect(args).not.toContain('--ignore-rules')
    child.emit('close',1)
  })
  it('sends prompt over stdin, flushes a final unterminated event, and finalizes once on close',()=>{
    const service=fixture(), terminal=vi.fn();service.on('terminal',terminal)
    let input='';child.stdin.on('data',(data:any)=>input+=data.toString())
    const run=service.start(payload)
    expect(mocks.spawn.mock.calls[0][1]).not.toContain(payload.prompt);expect(input).toBe(payload.prompt)
    child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'final answer'}})+'\n'+JSON.stringify({type:'turn.completed'}))
    child.emit('exit',0);expect(service.get(run.id)?.status).toBe('running')
    child.emit('close',0);child.emit('error',new Error('late error'))
    expect(service.get(run.id)).toMatchObject({status:'completed',result:{text:'final answer',terminal:true}});expect(terminal).toHaveBeenCalledOnce()
  })
  it('waits for process closure before marking cancellation terminal and requests tree termination',async()=>{
    const service=fixture(),run=service.start(payload);expect(service.cancel(run.id)).toBe(true)
    expect(mocks.terminate).toHaveBeenCalledWith(child);expect(service.get(run.id)?.status).toBe('running')
    child.emit('close',1);await vi.waitFor(()=>expect(service.get(run.id)?.status).toBe('canceled'))
  })
  it('treats semantic error and missing terminal output as failures even with exit zero',()=>{
    const service=fixture(),run=service.start(payload);child.stdout.write(JSON.stringify({type:'turn.failed'})+'\n');child.emit('close',0);expect(service.get(run.id)?.status).toBe('errored')
    const second=service.start(payload);child.emit('close',0);expect(service.get(second.id)?.status).toBe('errored')
  })
  it('times out execution and preserves the timeout as a terminal error',async()=>{
    vi.useFakeTimers();const service=fixture(),run=service.start({...payload,timeoutMs:10});vi.advanceTimersByTime(11);expect(mocks.terminate).toHaveBeenCalled();child.emit('close',1);await Promise.resolve();await Promise.resolve();expect(service.get(run.id)).toMatchObject({status:'errored',error:'Execution timed out'})
  })
  it('reconciles a persisted running process to interrupted failure on reconstruction',()=>{
    const root=mkdtempSync(join(tmpdir(),'hydra-execution-test-'));roots.push(root)
    writeFileSync(join(root,'stale.meta.json'),JSON.stringify({schemaVersion:1,run:{id:'stale',prompt:'p',projectDir:root,provider:'codex',model:'m',resumeSessionId:null,status:'running',startedAt:new Date().toISOString(),endedAt:null,sessionId:null,error:null}}))
    const service=new HeadlessOrchestrator(root);expect(service.get('stale')).toMatchObject({status:'errored',error:'Interrupted by daemon restart'})
  })
})
