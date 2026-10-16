import { useMemo, useState } from 'react'
import { Archive, GitBranch, MessagesSquare, Search, Trash2 } from 'lucide-react'
import type { Task } from '@hydra/protocol'
import { Badge, Button, EmptyState, Panel } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { shallow } from '../api/store'
import { NewTaskForm } from './NewTaskForm'
import { ChecksPanel } from './ChecksPanel'
import { ago, statusLabel, usageLine } from '../lib/format'

const PAGE = 25

/** A conversation is a first message plus its follow-ups; a change is a conversation of one. */
interface Thread { root: Task; latest: Task; turns: Task[] }

function threads(tasks: Task[]): Thread[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const rootOf = (t: Task): Task => {
    let current = t
    for (let i = 0; i < 50 && current.followUpOf && byId.has(current.followUpOf); i++) current = byId.get(current.followUpOf)!
    return current
  }
  const groups = new Map<string, Task[]>()
  for (const t of tasks) {
    const root = rootOf(t)
    groups.set(root.id, [...(groups.get(root.id) ?? []), t])
  }
  return [...groups.entries()].map(([rootId, turns]) => {
    turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return { root: byId.get(rootId)!, latest: turns.at(-1)!, turns }
  }).sort((a, b) => b.latest.updatedAt.localeCompare(a.latest.updatedAt))
}

export function ProjectView({ projectId }: { projectId: string }) {
  const { go, run, isRemote } = useApp()
  const project = useAppState((s) => s.projects.find((p) => p.id === projectId))
  const mine = useAppState((s) => Object.values(s.tasks).filter((t) => t.projectId === projectId), shallow)
  const [query, setQuery] = useState('')
  const [archived, setArchived] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const all = useMemo(() => threads(mine), [mine])
  if (!project) return <div className="page"><EmptyState title="Project not found" /></div>

  const needle = query.trim().toLowerCase()
  const visible = all
    .filter((th) => Boolean(th.root.archivedAt) === archived)
    .filter((th) => !needle || th.turns.some((t) => `${t.title}\n${t.prompt}\n${t.answer ?? ''}`.toLowerCase().includes(needle)))
  const archivedCount = all.filter((th) => th.root.archivedAt).length

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title">
          <h1>{project.name}</h1>
          <div className="row faint mono" style={{ fontSize: 12 }}>{project.root}{project.isGit ? <Badge tone="info" plain><GitBranch size={11} />git</Badge> : <Badge tone="warn">not a git repo</Badge>}</div>
        </div>
        {!isRemote && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void run({ type: 'project.remove', projectId }, 'Project removed from Hydra (files untouched)').then((ack) => ack.ok && go({ view: 'home' }))}>Remove</Button>}
      </div>
      <Panel title="Ask or change"><NewTaskForm projectId={projectId} isGit={project.isGit} /></Panel>
      {!isRemote && <ChecksPanel projectId={projectId} isGit={project.isGit} />}
      <Panel title={archived ? `Archived · ${visible.length}` : `History · ${visible.length}`} actions={
        <>
          <label className="history-search"><Search size={14} aria-hidden /><input className="hx-input" type="search" placeholder="Search questions, answers, changes" aria-label="Search history" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }} /></label>
          <Button size="sm" variant="ghost" icon={<Archive size={14} />} aria-pressed={archived} onClick={() => { setArchived(!archived); setShown(PAGE) }}>{archived ? 'Back to history' : `Archived${archivedCount ? ` (${archivedCount})` : ''}`}</Button>
        </>
      }>
        {visible.length === 0 ? (
          <p className="muted">{needle ? 'Nothing matches your search.' : archived ? 'Nothing archived.' : 'No tasks in this project yet.'}</p>
        ) : (
          <div className="task-rows">
            {visible.slice(0, shown).map(({ root, latest, turns }) => {
              const s = statusLabel(latest)
              return (
                <button key={root.id} className="task-row" onClick={() => go({ view: 'task', taskId: latest.id })}>
                  <span className="task-row__main">
                    <span className="task-row__title truncate">{root.title}</span>
                    <span className="task-row__now faint truncate">
                      <span>{root.intent === 'analyze' ? (turns.length > 1 ? <><MessagesSquare size={11} aria-hidden /> {turns.length} messages</> : 'Question') : `Change · ${root.mode}`}</span>
                      <span> · {usageLine(latest.usage)} · {ago(latest.updatedAt)}</span>
                    </span>
                  </span>
                  <span className="task-row__meta"><Badge tone={s.tone} live={s.live}>{s.label}</Badge></span>
                </button>
              )
            })}
            {visible.length > shown && <Button variant="ghost" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}</Button>}
          </div>
        )}
      </Panel>
    </div>
  )
}
