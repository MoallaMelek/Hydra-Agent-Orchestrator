import { FolderPlus, ShieldCheck, GitBranch, FlaskConical } from 'lucide-react'
import { HydraMark } from '../brand/HydraMark'
import { Badge, Button, Panel } from '../design/components'
import { useApp } from '../app/context'
import { StagePipeline } from './StagePipeline'
import { ago, statusLabel } from '../lib/format'

export function HomeView({ onAddProject }: { onAddProject: () => void }) {
  const { state, go } = useApp()
  const tasks = Object.values(state.tasks).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const needsYou = tasks.filter((t) => t.status === 'waiting_input')
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'queued')
  const projectName = (id: string) => state.projects.find((p) => p.id === id)?.name ?? 'Unknown project'

  if (!state.projects.length) {
    return (
      <div className="page" style={{ maxWidth: 760, paddingTop: 72 }}>
        <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 16 }}>
          <span style={{ color: 'var(--text)' }}><HydraMark size={56} /></span>
          <h1>Supervised AI development, isolated by default</h1>
          <p className="muted" style={{ maxWidth: 560 }}>
            Hydra plans, implements, reviews and verifies changes with Claude Code and Codex in an isolated git worktree. Nothing touches your branch until you accept a verified result.
          </p>
          <Button variant="primary" size="lg" icon={<FolderPlus size={16} />} onClick={onAddProject}>Add a project</Button>
        </div>
        <div className="stats" style={{ justifyContent: 'center', marginTop: 32 }}>
          {[
            [<GitBranch key="g" size={18} />, 'Isolated worktree per task'],
            [<FlaskConical key="f" size={18} />, 'Tests run by Hydra, not claimed by agents'],
            [<ShieldCheck key="s" size={18} />, 'You approve every change']
          ].map(([icon, text], i) => <div key={i} className="row muted" style={{ fontSize: 13 }}>{icon}{text}</div>)}
        </div>
      </div>
    )
  }

  const row = (t: typeof tasks[number]) => {
    const s = statusLabel(t)
    return (
      <button key={t.id} className="task-card" onClick={() => go({ view: 'task', taskId: t.id })}>
        <div style={{ minWidth: 0 }}>
          <div className="task-card__title truncate">{t.title}</div>
          <div className="task-card__meta"><span>{projectName(t.projectId)}</span><span>{ago(t.updatedAt)}</span></div>
        </div>
        <StagePipeline task={t} compact />
        <Badge tone={s.tone} live={s.live}>{s.label}</Badge>
      </button>
    )
  }

  return (
    <div className="page">
      <div className="page__head"><div className="page__title"><h1>Overview</h1><p className="muted">{running.length} running · {needsYou.length} waiting for you</p></div></div>
      <Panel title="Needs your decision">
        {needsYou.length ? <div className="task-list">{needsYou.map(row)}</div> : <p className="muted">Nothing is waiting for you.</p>}
      </Panel>
      <Panel title="Recent tasks">
        {tasks.length ? <div className="task-list">{tasks.slice(0, 12).map(row)}</div> : <p className="muted">No tasks yet. Open a project to start one.</p>}
      </Panel>
    </div>
  )
}
