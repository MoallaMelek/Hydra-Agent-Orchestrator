import { GitBranch, Trash2 } from 'lucide-react'
import { Badge, Button, EmptyState, Panel } from '../design/components'
import { useApp } from '../app/context'
import { StagePipeline } from './StagePipeline'
import { NewTaskForm } from './NewTaskForm'
import { ago, statusLabel, usageLine } from '../lib/format'

export function ProjectView({ projectId }: { projectId: string }) {
  const { state, go, run, isRemote } = useApp()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return <div className="page"><EmptyState title="Project not found" /></div>
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <h1>{project.name}</h1>
          <div className="row faint mono" style={{ fontSize: 12 }}>{project.root}{project.isGit ? <Badge tone="info" plain><GitBranch size={11} />git</Badge> : <Badge tone="warn">not a git repo</Badge>}</div>
        </div>
        {!isRemote && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void run({ type: 'project.remove', projectId }, 'Project removed from Hydra (files untouched)').then((ack) => ack.ok && go({ view: 'home' }))}>Remove</Button>}
      </div>
      <Panel title="New task"><NewTaskForm projectId={projectId} isGit={project.isGit} /></Panel>
      <Panel title={`Tasks · ${tasks.length}`}>
        {tasks.length === 0 ? <p className="muted">No tasks in this project yet.</p> : (
          <div className="task-list">
            {tasks.map((t) => {
              const s = statusLabel(t)
              return (
                <button key={t.id} className="task-card" onClick={() => go({ view: 'task', taskId: t.id })}>
                  <div style={{ minWidth: 0 }}>
                    <div className="task-card__title truncate">{t.title}</div>
                    <div className="task-card__meta"><span>{t.intent === 'analyze' ? 'Question' : t.mode}</span><span>{usageLine(t.usage)}</span><span>{ago(t.createdAt)}</span></div>
                  </div>
                  <StagePipeline task={t} compact />
                  <Badge tone={s.tone} live={s.live}>{s.label}</Badge>
                </button>
              )
            })}
          </div>
        )}
      </Panel>
    </div>
  )
}
