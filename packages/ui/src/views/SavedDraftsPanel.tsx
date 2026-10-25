import { useState } from 'react'
import { putDraft, useSavedDrafts } from '../app/preferences'
import { useApp, useAppState } from '../app/context'
import { Button, Dialog, Panel } from '../design/components'

export function SavedDraftsPanel() {
  const drafts = useSavedDrafts()
  const { go } = useApp()
  const projects = useAppState(state => state.projects)
  const tasks = useAppState(state => state.tasks)
  const [discard, setDiscard] = useState<string | null>(null)
  const [error, setError] = useState('')
  const entries = Object.entries(drafts)
  return <Panel title="Saved drafts">
    <p className="muted">Unsent messages, attachments and review feedback stay on this device. Send or explicitly discard them before restarting for an update.</p>
    {!entries.length && <p className="faint" style={{ marginTop: 12 }}>No unsent work.</p>}
    {entries.map(([key, draft]) => {
      const split = key.indexOf(':'); const kind = key.slice(0, split), id = key.slice(split + 1)
      const project = kind === 'project' ? projects.find(project => project.id === id) : undefined
      const task = tasks[id]
      const label = project?.name ?? task?.title ?? 'Previous conversation'
      return <div key={key} className="saved-draft">
        <strong>{label}</strong><p className="muted">{draft.text.slice(0, 140) || 'Attachments only'}{draft.text.length > 140 ? '…' : ''}</p>
        <span className="faint">{draft.attachments.length} attachment{draft.attachments.length === 1 ? '' : 's'}{draft.routing ? ` · ${draft.routing === 'auto' ? 'Automatic routing' : draft.routing === 'deep' ? 'Full change' : draft.routing === 'fast' ? 'Quick answer' : 'Code question'}` : ''}</span>
        <div className="row" style={{ marginTop: 8 }}>
          <Button size="sm" disabled={!project && !task} onClick={() => { if (project) go({ view: 'project', projectId: project.id }); else if (task) go({ view: 'task', taskId: task.id }) }}>Open</Button>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(draft, null, 2)).catch(() => setError('Could not copy. Open the draft to select and copy its contents.'))}>Copy draft</Button>
          <Button size="sm" variant="ghost" onClick={() => setDiscard(key)}>Discard…</Button>
        </div>
      </div>
    })}
    {error && <p role="alert">{error}</p>}
    <Dialog open={discard !== null} onClose={() => setDiscard(null)} title="Discard this unsent draft?" footer={<><Button onClick={() => setDiscard(null)}>Keep draft</Button><Button variant="danger" onClick={() => { if (discard) putDraft(discard, { text: '', attachments: [] }); setDiscard(null) }}>Discard draft</Button></>}><p>This removes the unsent text and attachments from this device. Sent conversation history is kept.</p></Dialog>
  </Panel>
}
