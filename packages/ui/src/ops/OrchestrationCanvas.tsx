import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Braces, Check, CircleHelp, FileText, GitBranch, GitPullRequest, Hand, RotateCcw, ScanLine } from 'lucide-react'
import { approvalContext, checkSpecBinding, verificationReceipt, type AgentRunInfo, type Evidence, type Task } from '@hydra/protocol'
import { useAppState } from '../app/context'
import { Button, Segmented } from '../design/components'
import { duration, shortSha } from '../lib/format'
import { Markdown } from '../lib/markdown'
import { revealInWorkspace } from '../lib/reveal'
import { Inspector } from './Inspector'
import { missionScene, recordedMoments, STATION, type StationId } from './missionScene'
import type { Trace } from './model'
import type { Selection } from './RelayTrace'
import { RelayTrace } from './RelayTrace'
import { SpatialCanvas } from './SpatialCanvas'

const ICON = { plan: FileText, build: Braces, review: GitPullRequest, repair: RotateCcw, checks: ScanLine, decision: Hand }
const STATUS = { none:'No record yet', running:'In progress', ok:'Execution finished', failed:'Failed', waiting:'Waiting', canceled:'Canceled', interrupted:'Interrupted' }

/** Fixed geometry, bounded records, no force simulation or idle animation loop. */
export function OrchestrationCanvas({task,trace,runs,evidence,onInspect,controls}: { task:Task;trace:Trace;runs:AgentRunInfo[];evidence:Evidence[];onInspect:(tab:'summary'|'changes'|'checks'|'log')=>void;controls?:ReactNode }) {
  const [view,setView]=useState<'flow'|'network'|'timeline'|'records'>('flow')
  const [cursor,setCursor]=useState<number|null>(null)
  const [chosen,setChosen]=useState<StationId|null>(null)
  const [recordId,setRecordId]=useState<string|null>(null)
  const [traceSelection,setTraceSelection]=useState<Selection>(null)
  const [playing,setPlaying]=useState(false)
  const connected=useAppState(s=>s.connection==='live')
  const scene=useMemo(()=>missionScene(trace,cursor),[trace,cursor])
  const moments=useMemo(()=>recordedMoments(trace),[trace])
  const focus=chosen ?? STATION[task.stage]
  const station=scene.stations.find(s=>s.id===focus)!
  const receipt=verificationReceipt(task,evidence)
  const finalChecks=station.id==='checks' && cursor===null ? station.records.filter(r=>r.ref.type==='evidence'&&evidence.some(e=>e.id===r.id&&e.phase==='verify'&&e.commitSha===receipt.revision)) : []
  const record=station.records.find(s=>s.id===recordId) ?? finalChecks.at(-1) ?? station.records.at(-1)
  const selection:Selection=traceSelection ?? (record ? {kind:'segment',id:record.id} : null)
  const approval=approvalContext(task,evidence)
  const reveal=()=>{if(matchMedia('(max-width: 900px)').matches)requestAnimationFrame(()=>revealInWorkspace(document.getElementById('mission-focus')))}
  const choose=(id:StationId)=>{setChosen(id);setRecordId(null);setTraceSelection(null);reveal()}
  const selectTrace=(s:Selection)=>{
    if(!s)return
    const r=s.kind==='segment'?scene.records.find(r=>r.id===s.id):undefined
    const lane=s.kind==='lane'?s.id:s.kind==='baton'?trace.batons.find(b=>b.id===s.id)?.lane:r?.lane
    const byLane:Record<string,StationId>={you:'decision',planner:'plan',implementer:'build',reviewer:'review',hydra:'checks'}
    setChosen(r?.kind==='check'?'checks':r?.stage?STATION[r.stage]:byLane[lane??'']??'plan')
    setRecordId(r?.id??null);setTraceSelection(s);reveal()
  }
  const historical=cursor!==null
  const latestArtifact=(stage:'plan'|'review')=>{
    const last=task.stages.filter(s=>s.stage===stage).at(-1)
    return !historical&&last?.status==='succeeded'&&last.endedAt&&record?.kind==='run'&&record.stage===stage&&record.start>=Date.parse(last.startedAt)&&record.end!==null&&record.end<=Date.parse(last.endedAt)&&(!traceSelection||traceSelection.kind==='segment'&&traceSelection.id===record.id)
  }
  const projectedTrace:Trace=historical?{...trace,segments:scene.records,batons:trace.batons.filter(b=>b.at<=scene.at),stages:trace.stages.filter(s=>s.start<=scene.at).map(s=>s.end!==null&&s.end>scene.at?{...s,end:null,status:'running',note:null}:s)}:trace
  const index=historical ? Math.max(0,moments.times.findIndex(t=>t===cursor)) : moments.times.length-1
  const step=(delta:number)=>{setPlaying(false);const next=Math.max(0,Math.min(moments.times.length-1,index+delta));setCursor(moments.times[next] ?? trace.start);setRecordId(null)}
  useEffect(()=>{
    if(!playing || !historical) return
    const timer=setTimeout(()=>{
      if(document.visibilityState!=='visible'||index>=moments.times.length-1){setPlaying(false);return}
      setCursor(moments.times[index+1]!);setRecordId(null)
    },650)
    return ()=>clearTimeout(timer)
  },[playing,historical,index,moments.times])
  const detail=historical ? 'Recorded replay' : !connected ? 'Saved snapshot · engine connection unavailable' : task.waitReason==='final_approval' ? approval.allowed?'Your decision · current checks and review resolved':'Your decision · unresolved conditions block acceptance' : trace.headline.text
  const reviewCurrent=task.reviewedSha===receipt.revision && task.stages.filter(s=>s.stage==='review').at(-1)?.status==='succeeded'
  const verifyStage=task.stages.filter(s=>s.stage==='verify').at(-1)
  const checksCurrent=verifyStage?.status==='succeeded' && receipt.checks.length>0 && receipt.checks.every(({spec,result})=>result && result.taskId===task.id && result.required===spec.required && result.checkSpec===checkSpecBinding(spec) && !result.definitionsChanged && verifyStage.endedAt && result.startedAt>=verifyStage.startedAt && result.startedAt<=verifyStage.endedAt)
  const detailOf=(id:StationId)=>{
    if(historical) return null
    if(id==='review' && task.review) return !reviewCurrent ? 'Stale or incomplete review' : task.review.verdict==='approve' && !task.review.findings.some(f=>f.severity==='blocker'||f.severity==='major') && task.review.acceptanceCriteriaMet.every(c=>c.met) ? 'Review approved' : 'Changes requested'
    if(id==='checks' && (task.stage==='approval'||task.outcome)) return !checksCurrent ? 'Stale, missing or untrusted' : receipt.state==='passed' ? 'Current evidence passed' : receipt.state==='failed' ? 'Failed or untrusted evidence' : 'Missing / stale evidence'
    if(id==='decision' && task.waitReason==='final_approval') return approval.allowed?'Ready for your decision':'Acceptance blocked'
    if(id==='decision' && task.outcome) return task.outcome==='applied'?'Accepted and applied':task.outcome==='rolled_back'?'Reverted with a new commit':'Branch preserved / discarded'
    return null
  }
  return <section className="mission-scene" aria-label="Living orchestration canvas">
    <header className="mission-scene__bar"><div><h2>Engineering in view</h2><p role="status">{detail}</p></div><Segmented label="Orchestration view" value={view} onChange={setView} options={[{value:'flow',label:'Flow'},{value:'network',label:'Network'},{value:'timeline',label:'Timeline'},{value:'records',label:'Records'}]}/></header>
    <div className="mission-scene__body">
      <div className="mission-scene__work">
        <div className="mission-scene__caption"><span>{historical?'Historical projection':'Recorded operations'} · agents take turns{!historical&&task.workspace?.headSha&&<> · revision <code>{shortSha(task.workspace.headSha)}</code></>}</span><Button size="sm" variant="ghost" onClick={()=>{setPlaying(false);setChosen(null);setRecordId(null);setTraceSelection(null);setCursor(null)}}>Inspect current work</Button></div>
        {view==='flow'||view==='network' ? <SpatialCanvas scene={scene} layout={view} focus={focus} selected={record?.id} statusOf={detailOf} onStation={choose} onRecord={r=>{setTraceSelection(null);setChosen(r.kind==='check'?'checks':r.stage?STATION[r.stage]:'decision');setRecordId(r.id);reveal()}}/> : view==='timeline' ? <div className="mission-timeline" role="region" aria-label="Agent swimlane timeline" tabIndex={0}><RelayTrace trace={projectedTrace} cursor={cursor} selection={selection} onSelect={selectTrace}/></div> : <ol className="mission-records" aria-label="Recorded operations">{scene.records.length>100&&<li>Showing the latest 100 operations. Earlier records remain in the mission log.</li>}{scene.records.slice(-100).map(r=><li key={r.id}><button aria-pressed={record?.id===r.id} onClick={()=>{setTraceSelection(null);setChosen(r.kind==='check'?'checks':r.stage?STATION[r.stage]:'decision');setRecordId(r.id);reveal()}}><time>+{duration(r.start-trace.start)}</time><span><b>{r.label}</b><small>{STATUS[r.status]} · {r.basis}</small></span><ArrowRight size={14}/></button></li>)}{!scene.records.length&&<li>No operations recorded at this point.</li>}</ol>}
        <div className="mission-replay"><div className="row"><Button size="sm" variant="ghost" aria-label="Previous recorded moment" icon={<ArrowLeft size={14}/>} disabled={!moments.times.length||index===0} onClick={()=>step(-1)}/><Button size="sm" variant="ghost" aria-label="Next recorded moment" icon={<ArrowRight size={14}/>} disabled={!historical||index>=moments.times.length-1} onClick={()=>step(1)}/><b>{historical?`Recorded moment ${index+1}/${moments.times.length}`:'Latest record'}</b><span className="grow"/>{historical?<><Button size="sm" variant="ghost" onClick={()=>setPlaying(!playing)}>{playing?'Pause replay':'Play records'}</Button><Button size="sm" onClick={()=>{setPlaying(false);setCursor(null);setRecordId(null)}}>Return to latest</Button></>:<Button size="sm" variant="ghost" disabled={moments.times.length<2} onClick={()=>{setPlaying(false);setCursor(moments.times[0]!);setRecordId(null)}}>Replay records</Button>}</div><input aria-label="Recorded moment" type="range" min="0" max={Math.max(0,moments.times.length-1)} value={index} disabled={moments.times.length<2} onChange={e=>{setPlaying(false);setCursor(moments.times[Number(e.target.value)]!);setRecordId(null)}}/><p>{moments.omitted?`Showing the latest 180 moments; ${moments.omitted} older moments omitted. `:''}Replay steps through recorded timestamps. Live streamed output is not retained for historical replay.</p></div>
      </div>
      <aside className="mission-focus" id="mission-focus" tabIndex={-1} aria-label={`${station.title} evidence`}>
        <header><span className="role-mark">{(() => { const Icon=ICON[focus];return <Icon size={22}/> })()}</span><div><h3>{station.title}</h3><p>{station.actor}</p></div></header>
        <Button className="mission-focus__back" size="sm" variant="ghost" onClick={()=>{setView('flow');requestAnimationFrame(()=>revealInWorkspace(document.querySelector<HTMLButtonElement>('.spatial-node[aria-pressed="true"]'),true))}}>Back to canvas</Button>
        {station.records.length>1 && <label className="mission-focus__attempt">{station.records.length>100?'Latest 100 operations':'Operation'}<select className="hx-select" aria-label="Select recorded operation" value={record?.id??''} onChange={e=>{setTraceSelection(null);setRecordId(e.target.value)}}>{station.records.slice(-100).map((r,i)=><option key={r.id} value={r.id}>{i+1} · {r.label}</option>)}</select></label>}
        {historical ? <div className="mission-historical"><CircleHelp size={22}/><h4>{record?.label ?? 'No operation recorded'}</h4><p>{record ? `${STATUS[record.status]} · ${record.basis} · +${duration(record.start-trace.start)}`:'This participant has no record at the selected moment.'}</p><p>Historical artifact snapshots are unavailable. Current summaries, output and decisions are hidden here to avoid showing future information.</p></div> : <>
          {focus==='plan'&&task.plan&&latestArtifact('plan')&&<div className="mission-focus__finding"><b>Current proposed plan · {task.plan.steps.length} step{task.plan.steps.length===1?'':'s'}</b><Markdown text={task.plan.summary}/><ol>{task.plan.steps.slice(0,4).map((step,i)=><li key={i}>{step}</li>)}</ol>{task.plan.steps.length>4&&<p>Open mission details for the complete plan.</p>}<p>Proposed steps are not separately scheduled agent tasks.</p></div>}
          {focus===STATION[task.stage]&&controls&&<div className="mission-focus__controls">{controls}</div>}
          {focus==='review'&&task.review&&(latestArtifact('review')?<div className="mission-focus__finding"><b>Current review · {detailOf('review')}</b><Markdown text={task.review.summary}/>{task.review.findings.slice(0,3).map((f,i)=><p key={i}>{f.severity}: {f.issue}</p>)}</div>:<div className="mission-focus__finding"><b>Earlier or incomplete review operation</b><p>The task stores the latest review summary. A historical verdict snapshot is unavailable for this selected operation; inspect its recorded run and output below.</p></div>)}
          {focus==='decision'&&task.waitReason==='final_approval'&&!controls&&<div className="mission-focus__finding"><b>{approval.allowed?'Ready to inspect and accept':'Repair before delivery'}</b>{approval.unresolved.length>0?<ul>{approval.unresolved.slice(0,5).map((r,i)=><li key={i}>{r}</li>)}</ul>:<p>Acceptance applies the exact reviewed revision. Your project must be clean.</p>}</div>}
          {selection ? <Inspector trace={trace} task={task} runs={runs} evidence={evidence} selection={selection} onSelect={selectTrace}/> : <div className="mission-historical"><p>No operation has been recorded for this participant.</p>{focus==='plan'&&task.plan&&<Markdown text={task.plan.summary}/>}</div>}
          <Button size="sm" variant="ghost" icon={focus==='build'?<GitBranch size={14}/>:<Check size={14}/>} onClick={()=>onInspect(focus==='checks'?'checks':focus==='build'||focus==='repair'?'changes':'summary')}>Open {focus==='checks'?'check evidence':focus==='build'||focus==='repair'?'revision diff':'mission details'}</Button>
        </>}
      </aside>
    </div>
  </section>
}
