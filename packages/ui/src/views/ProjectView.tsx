import { useEffect, useState } from 'react'
import { Archive, GitBranch, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { TaskHistoryPage, TaskHistoryQuery } from '@hydra/protocol'
import { Badge, Button, EmptyState, Panel } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { NewTaskForm } from './NewTaskForm'
import { ChecksPanel } from './ChecksPanel'
import { ago, statusLabel } from '../lib/format'

export function ProjectView({ projectId }: { projectId: string }) {
  const { go, run, store, isRemote } = useApp()
  const project = useAppState(s => s.projects.find(p => p.id === projectId))
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [before, setBefore] = useState<TaskHistoryQuery['before']>()
  const [page, setPage] = useState<TaskHistoryPage | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let canceled = false
    setBusy(true); setError('')
    const timer = setTimeout(() => {
      const load = store.transport.taskHistory
        ? store.transport.taskHistory({ projectId, query, archived, before })
        : Promise.resolve({ tasks: Object.values(store.get().tasks).filter(t => t.projectId === projectId && Boolean(t.archivedAt) === archived).slice(0, 25), next: null })
      void load.then(result => { if (!canceled) setPage(result) }).catch(e => { if (!canceled) setError((e as Error).message) }).finally(() => { if (!canceled) setBusy(false) })
    }, 200)
    return () => { canceled = true; clearTimeout(timer) }
  }, [store, projectId, query, archived, before, refresh])
  if (!project) return <div className="page"><EmptyState title="Project not found" /></div>
  return <div className="page project-workspace">
    <header className="page__head">
      <div className="page__title"><h1>{project.name}</h1><p className="muted">A question, a change, a clear next step.</p><p className="project-location"><GitBranch size={13} aria-hidden /> <span>{project.root}</span><Badge tone={project.isGit ? 'neutral' : 'warn'}>{project.isGit ? 'Git project' : 'Questions only'}</Badge></p></div>
      {!isRemote && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void run({ type: 'project.remove', projectId }, 'Project removed from Hydra (files untouched)').then(ack => ack.ok && go({ view: 'home' }))}>Remove</Button>}
    </header>
    <section className="request-sheet" aria-label="Start a conversation"><NewTaskForm projectId={projectId} isGit={project.isGit} /></section>
    {!isRemote && <details className="disclosure"><summary>Project checks <span>Commands Hydra runs to gather evidence</span></summary><ChecksPanel projectId={projectId} isGit={project.isGit} /></details>}
    <Panel title={archived ? 'Archive' : 'History'} actions={<>
      <label className="history-search"><Search size={14} aria-hidden /><input className="hx-input" type="search" placeholder="Search all project history" aria-label="Search history" maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setBefore(undefined) }} /></label>
      <Button size="sm" variant="ghost" icon={<Archive size={14} />} aria-pressed={archived} onClick={() => { setArchived(!archived); setBefore(undefined) }}>{archived ? 'Back to history' : 'Archived'}</Button>
      <Button size="sm" variant="ghost" aria-label="Refresh history" icon={<RefreshCw size={14} />} onClick={() => setRefresh(n => n + 1)} />
    </>}>
      <p className="faint section-note">Saved questions and changes · 25 per page. Search includes saved answers.</p>
      {error && <p role="alert">History could not load: {error} <button onClick={() => setRefresh(n => n + 1)}>Retry</button></p>}
      <div aria-busy={busy}>
        {busy ? <p role="status" className="muted">Loading history…</p> : !page?.tasks.length ? <EmptyState title={query ? 'No matching work' : archived ? 'Nothing archived' : 'Your next idea starts above'} /> : <div className="task-rows">{page.tasks.map(task => {
          const status = statusLabel(task)
          return <button key={task.id} className="task-row" onClick={() => go({ view: 'task', taskId: task.id })}><span className="task-row__main"><strong className="task-row__title truncate">{task.title}</strong><span className="faint">{task.followUpOf ? 'Follow-up' : task.intent === 'analyze' ? 'Question' : 'Change'} · {ago(task.updatedAt)}</span></span><Badge tone={status.tone}>{status.label}</Badge></button>
        })}</div>}
      </div>
      <div className="history-paging">{before && <Button size="sm" onClick={() => setBefore(undefined)}>Back to newest</Button>}{page?.next && <Button size="sm" disabled={busy} onClick={() => setBefore(page.next ?? undefined)}>Older work</Button>}</div>
    </Panel>
  </div>
}
