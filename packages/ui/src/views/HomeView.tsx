import { useMemo, useState } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import type { Task } from '@hydra/protocol'
import { HydraMark } from '../brand/HydraMark'
import { Badge, Button, Callout } from '../design/components'
import { shallow } from '../api/store'
import { useApp, useAppState } from '../app/context'
import { providerReady, SetupChecklist } from './SetupChecklist'
import { ago, statusLabel } from '../lib/format'
import { NewTaskForm } from './NewTaskForm'
import { IntelNetwork } from '../ops/intel/IntelNetwork'
import { useProjectNetwork } from '../ops/intel/project'
import { MapSelection } from '../ops/intel/MapSelection'

function MissionRow({ task, project, onOpen }: { task: Task; project: string; onOpen: () => void }) {
  const s = statusLabel(task)
  const waiting = task.status === 'waiting_input'
  return <button className={`mrow ${waiting ? 'mrow--you' : ''}`} onClick={onOpen}>
    <span className="mrow__main">
      <b className="truncate">{task.title}</b>
      <small className="faint">{project} · {waiting ? (task.waitReason === 'plan_approval' ? 'Plan ready · nothing written yet' : task.waitReason === 'final_approval' ? `Revision ${task.workspace?.headSha?.slice(0, 7) ?? ''} waits for you` : 'Input needed') : `${task.intent === 'analyze' ? 'Question' : 'Change'} · ${ago(task.updatedAt)}`}</small>
    </span>
    <Badge tone={s.tone} live={s.live}>{s.label}</Badge>
    <ArrowRight size={14} aria-hidden />
  </button>
}

export function HomeView({ onAddProject }: { onAddProject: () => void }) {
  const { go, isRemote } = useApp()
  const ready = useAppState((s) => s.ready)
  const projects = useAppState((s) => s.projects)
  const providers = useAppState((s) => s.providers)
  const tasks = useAppState((s) => Object.values(s.tasks).filter((t) => !t.archivedAt), shallow)
  const [projectId, setProjectId] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const writingIn = projects.find((p) => p.id === projectId) ?? projects[0]
  const sorted = useMemo(() => [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [tasks])
  const needsYou = sorted.filter((t) => t.status === 'waiting_input')
  const underway = sorted.filter((t) => ['running', 'queued', 'paused', 'failed'].includes(t.status))
  const recent = sorted.filter((t) => !['running', 'queued', 'paused', 'failed', 'waiting_input'].includes(t.status)).slice(0, 6)
  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? 'Unknown project'
  const network = useProjectNetwork(writingIn?.id)

  if (!ready) return <div className="page" aria-busy="true"><h1>Hydra</h1><p role="status" className="muted">Connecting to the engine…</p></div>
  if (!projects.length) return <div className="page first-run">
    <div className="first-run__intro">
      <HydraMark size={44} />
      <h1>Your request. Their runs. Your decision.</h1>
      <p className="muted">Hydra plans a change with the AI accounts you already use, builds it in an isolated Git worktree, runs your own checks on the exact revision, and waits for you before anything reaches your branch.</p>
      <ul className="first-run__facts">
        <li><span className="glyph g-revision" aria-hidden />An isolated branch for every mission</li>
        <li><span className="glyph g-check" aria-hidden />Hydra runs your checks itself</li>
        <li><span className="glyph g-decision" aria-hidden />Nothing applies without you</li>
      </ul>
    </div>
    <div>{isRemote ? <p className="muted">Add a project on your desktop to start a mission.</p> : <SetupChecklist onAddProject={onAddProject} />}</div>
  </div>

  return <div className="page home">
    <section className="home__compose" aria-label="New mission">
      <div className="home__compose-head">
        <h1>Describe a change.</h1>
        <div className="row">
          <label className="eyebrow" htmlFor="home-project">In</label>
          <select id="home-project" className="hx-select home__project" value={writingIn!.id} onChange={(e) => { setProjectId(e.target.value); setSelected(null) }}>{projects.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
          <span className="mono faint">{writingIn!.isGit ? 'isolated worktree' : 'questions only · not a Git repository'}</span>
          {!isRemote && <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={onAddProject}>Add project</Button>}
        </div>
      </div>
      <NewTaskForm key={writingIn!.id} projectId={writingIn!.id} isGit={writingIn!.isGit} />
      {!providers.some(providerReady) && <Callout tone="warn">No AI account is ready. Open AI accounts to install or sign in to a CLI.</Callout>}
    </section>

    <div className="home__grid">
      <section className="home__map" aria-label={`${writingIn!.name} project network`}>
        <div className="home__map-head">
          <h2 className="home__h">{writingIn!.name}</h2>
          <p className="faint">Missions linked only through files they recorded touching or planned to touch{network.missions > network.withRuns ? ` · ${network.missions - network.withRuns} of ${network.missions} show planned files only until opened` : ''}{network.truncated ? ' · latest 24' : ''}.</p>
        </div>
        {network.missions === 0
          ? <p className="home__empty">No change missions in {writingIn!.name} yet. Describe one above and Hydra plans it in an isolated worktree.</p>
          : <IntelNetwork compact graph={network.graph} layout={network.layout} lens="project" label={`Missions in ${writingIn!.name}`} selected={selected} onSelect={setSelected}
              onActivate={(id) => { if (id.startsWith('task:')) go({ view: 'task', taskId: id.slice(5) }); else setSelected(id) }}
              overlay={<MapSelection graph={network.graph} selected={selected} projectId={writingIn!.id} onOpen={(taskId) => go({ view: 'task', taskId })} onClose={() => setSelected(null)} />} />}
      </section>
      <aside className="home__side">
        {needsYou.length > 0 && <section className="home__you" aria-label="Waiting for your decision">
          <h2 className="home__h">Waiting for you <span className="mono faint">{needsYou.length}</span></h2>
          <div className="mrows">{needsYou.slice(0, 5).map((t) => <MissionRow key={t.id} task={t} project={nameOf(t.projectId)} onOpen={() => go({ view: 'task', taskId: t.id })} />)}</div>
        </section>}

        <section aria-label="Underway">
          <h2 className="home__h">Underway <span className="mono faint">{underway.length}</span></h2>
          {underway.length ? <div className="mrows">{underway.slice(0, 5).map((t) => <MissionRow key={t.id} task={t} project={nameOf(t.projectId)} onOpen={() => go({ view: 'task', taskId: t.id })} />)}</div> : <p className="faint">No mission is running.</p>}
        </section>
        <section aria-label="Recent">
          <h2 className="home__h">Recent</h2>
          {recent.length ? <div className="mrows">{recent.map((t) => <MissionRow key={t.id} task={t} project={nameOf(t.projectId)} onOpen={() => go({ view: 'task', taskId: t.id })} />)}</div> : <p className="faint">Recorded outcomes appear here.</p>}
          <button className="linkish" onClick={() => go({ view: 'project', projectId: writingIn!.id })}>Full history of {writingIn!.name}</button>
        </section>
      </aside>
    </div>
  </div>
}
