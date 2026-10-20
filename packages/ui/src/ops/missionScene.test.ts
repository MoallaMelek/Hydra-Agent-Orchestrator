import { describe, expect, it } from 'vitest'
import { buildTrace } from './model'
import { missionScene, recordedMoments } from './missionScene'
import { FixtureWorld } from '../lab/world'

function fixture() {
  const world=new FixtureWorld()
  const project=world.addProject('scene-fixture')
  const task=world.createTask(project.id,'A recorded repair')
  world.beginStage(task.id,'plan')
  const planner=world.startRun(task.id,'plan','planner','claude')
  const beginning=world.now
  world.now+=1000
  world.tool(planner.id,'Read','file.ts')
  world.now+=1000
  world.endRun(planner.id)
  world.endStage(task.id,'succeeded','Plan recorded')
  world.beginStage(task.id,'implement')
  const builder=world.startRun(task.id,'implement','implementer','codex')
  world.now+=1000
  world.endRun(builder.id)
  world.endStage(task.id,'succeeded','Revision saved')
  world.beginStage(task.id,'review')
  world.now+=1000
  world.endStage(task.id,'succeeded','Changes requested')
  world.beginStage(task.id,'fix')
  const repair=world.startRun(task.id,'fix','implementer','codex')
  world.now+=1000
  const trace=buildTrace({task:world.tasks.get(task.id)!,runs:[...world.runs.values()],evidence:world.evidence,now:world.now})
  return {world,task,trace,beginning,planner,repair}
}
describe('Mission scene evidence projection',()=>{
  it('does not reveal future completion, tool calls, review or repair while replaying the first run',()=>{
    const {trace,beginning}=fixture()
    const scene=missionScene(trace,beginning)
    const plan=scene.stations.find(s=>s.id==='plan')!
    expect(plan.status).toBe('running')
    expect(plan.records[0]!.end).toBeNull()
    expect(plan.records[0]!.ticks).toEqual([])
    expect(scene.stations.filter(s=>s.id!=='plan').every(s=>s.status==='none')).toBe(true)
    expect(scene.edges).toEqual([])
  })
  it('shows a repair relationship only after the actual repair stage starts',()=>{
    const {trace,repair}=fixture()
    const prior=missionScene(trace,Date.parse(repair.startedAt)-1)
    expect(prior.edges.some(e=>e.to==='repair')).toBe(false)
    const current=missionScene(trace,null)
    expect(current.edges).toContainEqual({from:'review',to:'repair'})
    expect(current.stations.find(s=>s.id==='repair')!.status).toBe('running')
    expect(current.stations).toHaveLength(6)
  })
  it('bounds discrete replay moments and omits invalid timestamps',()=>{
    const {trace}=fixture()
    const many={...trace,stages:Array.from({length:250},(_,i)=>({...trace.stages[0]!,start:trace.start+i*1000,end:trace.start+i*1000+1}))}
    const result=recordedMoments(many)
    expect(result.times).toHaveLength(180)
    expect(result.omitted).toBeGreaterThan(0)
    expect(result.times.every((time,i)=>Number.isFinite(time)&&(i===0||time>result.times[i-1]!))).toBe(true)
  })
  it('hides a command outcome before its recorded end time',()=>{
    const {trace}=fixture()
    const completed={...trace.segments[0]!,id:'check',kind:'check' as const,lane:'hydra' as const,label:'Tests passed',stage:'verify' as const,status:'ok' as const,start:trace.start,end:trace.start+5000}
    const scene=missionScene({...trace,segments:[completed]},trace.start+1000)
    expect(scene.records[0]).toMatchObject({status:'running',end:null,label:'Check in progress · result not yet recorded'})
  })
  it('does not announce successful apply before its recorded completion',()=>{
    const {trace}=fixture()
    const apply={...trace.segments[0]!,id:'apply',kind:'apply' as const,lane:'hydra' as const,label:'Applied to your branch',stage:'apply' as const,status:'ok' as const,start:trace.start,end:trace.start+5000}
    const projected=missionScene({...trace,segments:[apply]},trace.start+1000)
    expect(projected.records[0]).toMatchObject({status:'running',label:'Applying accepted revision · outcome not yet recorded'})
    expect(missionScene({...trace,segments:[apply]},trace.start+5000).records[0]!.label).toBe('Applied to your branch')
  })
})
