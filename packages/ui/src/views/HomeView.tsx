import { useMemo, useState } from 'react'
import { ArrowRight, Braces, GitBranch, Plus, ShieldCheck } from 'lucide-react'
import { HydraMark } from '../brand/HydraMark'
import { Badge, Button, Callout } from '../design/components'
import { shallow } from '../api/store'
import { useApp, useAppState } from '../app/context'
import { providerReady, SetupChecklist } from './SetupChecklist'
import { ago, statusLabel } from '../lib/format'
import { NewTaskForm } from './NewTaskForm'

export function HomeView({ onAddProject }: { onAddProject: () => void }) {
  const { go, isRemote } = useApp()
  const ready = useAppState(s=>s.ready)
  const projects = useAppState(s=>s.projects)
  const providers = useAppState(s=>s.providers)
  const tasks = useAppState(s=>Object.values(s.tasks).filter(t=>!t.archivedAt),shallow)
  const [composeProject,setComposeProject]=useState('')
  const [allDecisions,setAllDecisions]=useState(false)
  const writingIn=projects.find(p=>p.id===composeProject)??projects[0]
  const sorted=useMemo(()=>[...tasks].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),[tasks])
  const needsYou=sorted.filter(t=>t.status==='waiting_input')
  const underway=sorted.filter(t=>['running','queued','paused','failed'].includes(t.status))
  const recent=sorted.filter(t=>!['running','queued','paused','failed','waiting_input'].includes(t.status)).slice(0,5)
  const nameOf=(id:string)=>projects.find(p=>p.id===id)?.name??'Unknown project'
  if(!ready)return <div className="page" aria-busy="true"><h1>Mission control</h1><p role="status">Loading your workspace…</p></div>
  if(!projects.length)return <div className="page experience-onboarding"><div className="experience-onboarding__intro"><HydraMark size={64}/><h1>An objective.<br/>A team.<br/>Evidence you can trust.</h1><p>Direct an engineering change with your own AI accounts. Hydra keeps work isolated, makes contributions inspectable and returns delivery to you.</p><div className="onboarding__facts"><p><GitBranch size={17}/> An isolated branch for each change</p><p><Braces size={17}/> Agents build; Hydra runs your checks</p><p><ShieldCheck size={17}/> You control what reaches your project</p></div></div><div>{isRemote?<p>Add a project on your desktop to start a mission.</p>:<SetupChecklist onAddProject={onAddProject}/>}</div></div>
  return <div className="page operations-home command-home">
    <header className="page__head"><div><h1>Direct the next change.</h1><p className="muted">Your objective. Their contributions. Your decision.</p></div>{!isRemote&&<Button icon={<Plus size={15}/>} onClick={onAddProject}>Add project</Button>}</header>
    <div className="launch-deck">
      {writingIn&&<section className="request-sheet mission-launch" aria-label="Start a conversation"><div className="request-sheet__project"><label htmlFor="workspace-project">Project</label><select id="workspace-project" className="hx-select" value={writingIn.id} onChange={e=>setComposeProject(e.target.value)}>{projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><span className="mission-launch__branch"><GitBranch size={13}/>{writingIn.isGit?'Isolated changes':'Questions only'}</span></div><NewTaskForm key={writingIn.id} projectId={writingIn.id} isGit={writingIn.isGit}/></section>}
      <aside className="mission-readiness"><h2>Your AI accounts</h2><p>Readiness only · submit a mission to assign</p>{providers.map(p=><button key={p.id} className="readiness-provider" onClick={()=>go({view:'providers'})}><span className={`role-mark role-mark--${p.id==='claude'?'plan':'build'}`}><Braces size={19}/></span><span><b>{p.displayName}</b><small>{providerReady(p)?'CLI ready':p.installed?'Sign-in or setup needed':'Not installed'}</small></span><ArrowRight size={14}/></button>)}<div className="readiness-boundary"><ShieldCheck size={18}/><p>Assigned agents take turns within a mission. Hydra runs checks itself; you approve delivery.</p></div>{!providers.some(providerReady)&&<Callout tone="warn">Connect an AI account before starting work.</Callout>}</aside>
    </div>
    <div className="command-ledger">
      <section className="needs-you" aria-label="Waiting for your decision"><div className="command-section-head"><h2>Needs your direction</h2><span>{needsYou.length} loaded</span></div>{(allDecisions?needsYou:needsYou.slice(0,3)).map(t=><button className="needs-you__row" key={t.id} onClick={()=>go({view:'task',taskId:t.id})}><span className="attention-mark" aria-hidden/><span className="grow"><b>{t.title}</b><small>{nameOf(t.projectId)} · {t.waitReason==='plan_approval'?'Plan ready to inspect':t.waitReason==='final_approval'?'Result needs your decision':'Input needed'}</small></span><ArrowRight size={16}/></button>)}{!needsYou.length&&<p className="quiet-state">No decisions waiting. Your next mission starts above.</p>}{needsYou.length>3&&<Button size="sm" variant="ghost" onClick={()=>setAllDecisions(!allDecisions)}>{allDecisions?'Show fewer decisions':`Show all ${needsYou.length} loaded decisions`}</Button>}</section>
      <section aria-label="Current missions"><div className="command-section-head"><h2>On the workbench</h2><span>{underway.length} loaded</span></div>{underway.slice(0,4).map(t=>{const s=statusLabel(t);return <button className="mission-preview" key={t.id} onClick={()=>go({view:'task',taskId:t.id})}><span><b>{t.title}</b><small>{nameOf(t.projectId)} · {t.stage==='fix'?'Repair':t.stage} · {ago(t.updatedAt)}</small></span><Badge tone={s.tone}>{s.label}</Badge><ArrowRight size={15}/></button>})}{!underway.length&&<div className="quiet-state"><GitBranch size={25}/><p>No missions running.<br/>The workbench settles when your team does.</p></div>}</section>
    </div>
    <section aria-label="Recent tasks"><div className="command-section-head"><h2>Recent work</h2><span>Open a project for full, searchable history</span></div>{recent.map(t=>{const s=statusLabel(t);return <button className="mission-preview" key={t.id} onClick={()=>go({view:'task',taskId:t.id})}><span><b>{t.title}</b><small>{nameOf(t.projectId)} · {t.intent==='analyze'?'Question':'Change'} · {ago(t.updatedAt)}</small></span><Badge tone={s.tone}>{s.label}</Badge><ArrowRight size={15}/></button>})}{!recent.length&&<p className="muted">Your recorded outcomes will appear here.</p>}</section>
  </div>
}
