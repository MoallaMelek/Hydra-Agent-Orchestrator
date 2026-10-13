import { useCallback, useEffect, useRef, useState } from 'react'
import type { HydraTask, PermissionMode, TaskAttachment, TaskCommand } from '@shared/tasks'
import { TASK_ACTIVE_PHASES } from '@shared/tasks'
import type { ProviderId } from '@shared/types'
import { TaskMarkdown } from './TaskMarkdown'
import './TaskWorkspace.css'

const phaseLabel = (value: string) => value.replace(/_/g, ' ')
const projectName = (value: string) => value.split(/[\\/]/).filter(Boolean).at(-1) ?? value

export function TaskWorkspace({ onAgents, onSettings }: { onAgents: () => void; onSettings: () => void }) {
  const [tasks, setTasks] = useState<HydraTask[]>([])
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem('hydra:task-selection'))
  const [project, setProject] = useState('')
  const [projects, setProjects] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<PermissionMode>('safe')
  const [providers, setProviders] = useState<ProviderId[]>(['claude', 'codex'])
  const [intent, setIntent] = useState<'auto' | 'analyze' | 'implement'>('auto')
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [pending, setPending] = useState(false)
  const [sidebar, setSidebar] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState(false)
  const [logs, setLogs] = useState<Record<string, string>>({})
  const [streamingText, setStreamingText] = useState<Record<string, string>>({})
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const task = tasks.find(v => v.id === selected)
  const active = !!task && TASK_ACTIVE_PHASES.includes(task.phase)
  const waiting = task?.phase === 'awaiting_approval'

  const merge = useCallback((next: HydraTask) => setTasks(previous => [next, ...previous.filter(v => v.id !== next.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), [])
  const refresh = useCallback(async () => {
    try { const next = await window.hydra.listTasks(); setTasks(next); setConnected(true) }
    catch (err) { setConnected(false); setError((err as Error).message) }
  }, [])
  useEffect(() => {
    void refresh()
    void window.hydra.listAgents().then(agents => setProjects([...new Set(agents.map(v => v.projectDir))])).catch(() => {})
    const unsubscribe = window.hydra.onTaskChanged(merge)
    const activity = window.hydra.onTaskActivity(event => setLogs(previous => ({ ...previous, [event.attemptId]: ((previous[event.attemptId] ?? '') + event.line + '\n').slice(-32000) })))
    const text = window.hydra.onTaskText(event => setStreamingText(previous => ({ ...previous, [event.attemptId]: event.text.slice(-100000) })))
    const timer = setInterval(() => { void refresh() }, 3000)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { unsubscribe(); activity(); text(); clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [merge, refresh])
  useEffect(() => {
    if (selected) localStorage.setItem('hydra:task-selection', selected)
    else localStorage.removeItem('hydra:task-selection')
  }, [selected])
  useEffect(() => { end.current?.scrollIntoView?.({ behavior: 'smooth' }) }, [selected, task?.messages.length, task?.phase])
  const newTask = useCallback(() => { setSelected(null); setPrompt(''); setAttachments([]); setError(''); setEditing(false); setSidebar(false); input.current?.focus() }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'n') { event.preventDefault(); newTask() } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [newTask])

  const execute = async (operation: () => Promise<HydraTask>) => {
    setPending(true); setError('')
    try { const next = await operation(); merge(next); setSelected(next.id); return true }
    catch (err) { setError((err as Error).message); return false }
    finally { setPending(false) }
  }
  const command = (value: TaskCommand) => task ? execute(() => window.hydra.taskCommand(task.id, value)) : Promise.resolve(false)
  const submit = async () => {
    if (!prompt.trim() || active || waiting || pending) return
    if (!task && !project) { setError('Select a project folder before starting a task.'); return }
    const ok = await execute(() => task
      ? window.hydra.taskCommand(task.id, { action: 'message', prompt, attachments })
      : window.hydra.createTask({ projectDir: project, prompt, providers, permissionMode: mode, intent, attachments }))
    if (ok) { setPrompt(''); setAttachments([]); setEditing(false) }
  }
  const chooseProject = async () => {
    const dir = await window.hydra.selectDirectory()
    if (dir) { setProject(dir); setProjects(values => [...new Set([...values, dir])]) }
  }
  const attach = async (files: FileList | File[]) => {
    try {
      const next: TaskAttachment[] = []
      for (const file of Array.from(files)) {
        if (file.size > 16000 || !/\.(?:txt|md|tsx?|jsx?|json|css|html|py|rs|go|ya?ml|toml)$/i.test(file.name)) throw new Error('Attachments support text/code files up to 16 KB. Images and binaries are available in Agents.')
        if (/^\.env(?:\.|$)|(?:auth|token|credential|secret|service[-_]?account)[^\\/]*\.json$|\.(?:pem|key|p12|pfx)$/i.test(file.name)) throw new Error('Credential and secret attachments are not accepted.')
        const content = await file.text()
        if (content.includes('\0')) throw new Error('Binary attachments are not supported in task chat.')
        next.push({ name: file.name, content })
      }
      if (attachments.length + next.length > 8) throw new Error('Attach up to eight files.')
      setAttachments(values => [...values, ...next])
    } catch (err) { setError((err as Error).message) }
  }
  const visible = tasks.filter(v => `${v.title} ${v.projectDir} ${v.messages.map(m => m.content).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const knownProjects = [...new Set([...projects, ...tasks.map(v => v.projectDir)])]
  const draft = task?.attempts.findLast(v => v.role === 'synthesis' && v.status === 'running')

  return <div className="task-workspace">
    <aside className={`task-sidebar ${sidebar ? 'is-open' : ''}`} aria-label="Workspace navigation">
      <div className="task-brand"><span className="task-mark">H</span> Hydra <button className="mobile-only" aria-label="Close navigation" onClick={() => setSidebar(false)}>×</button></div>
      <button className="task-new" onClick={newTask}>＋ New task <kbd>Ctrl N</kbd></button>
      <label className="task-search"><span className="sr-only">Search conversations</span><input placeholder="Search conversations" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="task-section-label">Conversations</div>
      <nav className="task-history">{visible.map(value => <button key={value.id} aria-current={selected === value.id ? 'page' : undefined} onClick={() => { setSelected(value.id); setPrompt(''); setAttachments([]); setSidebar(false); setEditing(false); setError('') }}><span>{value.title}</span><small>{projectName(value.projectDir)} · {phaseLabel(value.phase)}</small></button>)}{!visible.length && <p className="task-muted">{query ? 'No matching conversations' : 'Your tasks will appear here.'}</p>}</nav>
      <div className="task-section-label">Projects</div>
      <div className="task-projects">{knownProjects.map(value => <button key={value} title={value} onClick={() => { newTask(); setProject(value) }}>{projectName(value)}</button>)}</div>
      <button onClick={() => { newTask(); void chooseProject().catch(err => setError(String(err))) }}>＋ Choose project</button>
      <footer><button onClick={onAgents}>◈ Agents <small>Terminals, editor & Git</small></button><button onClick={onSettings}>⚙ Settings</button><span className={connected ? 'task-connected' : 'task-offline'} role="status">{connected ? '● Connected to local daemon' : '◌ Reconnecting to local daemon…'}</span></footer>
    </aside>
    <main className="task-conversation" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!active && !waiting) void attach(event.dataTransfer.files) }}>
      <header className="task-header"><button className="mobile-only" aria-label="Open navigation" onClick={() => setSidebar(true)}>☰</button><div>
        {renaming && task ? <form onSubmit={event => { event.preventDefault(); void command({ action: 'rename', title }).then(ok => { if (ok) setRenaming(false) }) }}><input aria-label="Conversation name" value={title} maxLength={120} onChange={event => setTitle(event.target.value)} autoFocus /><button type="submit">Save</button><button type="button" onClick={() => setRenaming(false)}>Cancel</button></form> : <button className="task-title" disabled={!task} onClick={() => { setTitle(task?.title ?? ''); setRenaming(true) }}>{task?.title ?? 'New task'}{task && <span> ✎</span>}</button>}
        <small>{task ? projectName(task.projectDir) : 'One conversation. Shared context. Coordinated agents.'}</small></div><span className="task-phase" role="status">{task ? phaseLabel(task.phase) : 'Ready'}</span></header>
      <div className="task-scroll">
        {!task && <div className="task-welcome"><div className="task-eyebrow">YOUR AI WORKSPACE</div><h1>Talk to Hydra.<br />Let the agents work together.</h1><p>Inspect, implement, challenge and verify in one conversation.<br />Your existing Claude and Codex accounts power the work.</p><div className="task-suggestions">{['Inspect this project and explain its architecture.', 'Find the cause of the failing tests and fix it.', 'Improve this feature, review the changes and verify them.'].map(text => <button key={text} onClick={() => { setPrompt(text); setIntent('auto'); input.current?.focus() }}>{text} ↗</button>)}</div></div>}
        {task && <div className="task-messages">{task.messages.map(message => <article className={`task-message ${message.role}`} key={message.id}><div className="task-message-author">{message.role === 'user' ? 'You' : 'Hydra'}</div><TaskMarkdown content={message.content} />{message.attachments?.map((file, index) => <details key={index}><summary>Attachment · {file.name}</summary><pre>{file.content}</pre></details>)}{message.role === 'user' && <button className="task-text-button" disabled={active || waiting || pending} onClick={() => { setPrompt(message.content); setAttachments(message.attachments ?? []); setEditing(true); input.current?.focus() }}>Edit & resubmit</button>}</article>)}
          {task.error && <div className="task-error" role="alert">{task.error}</div>}
          {task.approval?.status === 'pending' && <section className="task-approval" role="alert"><h2>Approval required</h2><p>{task.approval.reason}</p><code>{task.approval.scope}</code><div><button disabled={pending} onClick={() => { void command({ action: 'approve', approvalId: task.approval!.id, approved: true }) }}>Approve project actions</button><button disabled={pending} onClick={() => { void command({ action: 'approve', approvalId: task.approval!.id, approved: false }) }}>Deny</button></div></section>}
          <section className="task-progress" aria-label="Task progress"><div className="task-progress-stages">{['planning', 'implementation', 'review', 'verification'].map(value => <span key={value} className={task.phase === value ? 'current' : task.events.some(v => v.phase === value) ? 'visited' : ''}>{task.events.some(v => v.phase === value) && task.phase !== value ? '✓ ' : task.phase === value ? '● ' : '○ '}{phaseLabel(value)}</span>)}</div>
            <details open={active || waiting}><summary>{active ? 'Hydra is working' : 'Agent activity'} · {task.attempts.length} executions</summary>{task.attempts.map(attempt => <details className="task-attempt" key={attempt.id}><summary><strong>{attempt.provider}</strong> — {attempt.role}<span>{attempt.status}</span></summary>{attempt.error && <p role="alert">{attempt.error}</p>}<TaskMarkdown content={streamingText[attempt.id] || attempt.summary || 'Waiting for a structured provider response…'} />{!!attempt.evidence.length && <details><summary>Observed command evidence</summary>{attempt.evidence.map((value, index) => <div key={index}><code>{value.command}</code><p>Exit code: {value.exitCode ?? 'unknown'}</p><pre>{value.output}</pre></div>)}</details>}<details><summary>Developer details / logs</summary><p>Run {attempt.runId ?? 'starting'} · Session {attempt.sessionId ?? 'pending'}</p><pre>{logs[attempt.id] ?? attempt.logs}</pre></details></details>)}</details>
            <details><summary>Plan, decisions & findings</summary><ol>{task.events.map(value => <li key={value.sequence}>{value.text}</li>)}</ol>{task.findings.map(value => <p key={value.id}>{value.disposition}: {value.text}</p>)}{task.decisions.map((value, index) => <p key={index}>Decision: {value}</p>)}</details>
          </section>
          {draft && <article className="task-message hydra" aria-label="Hydra streaming response"><div className="task-message-author">Hydra</div><TaskMarkdown content={streamingText[draft.id] || draft.summary || "Preparing the unified response…"} /><small className="task-muted">Live provider text. Claude streams deltas; Codex supplies completed message snapshots.</small></article>}
          {!active && !waiting && <div className="task-followup"><button disabled={pending || !connected} onClick={() => { void command({ action: 'retry' }) }}>Retry</button><button disabled={pending || !connected} onClick={() => { void command({ action: 'continue' }) }}>Continue</button><button onClick={newTask}>New task</button></div>}
        </div>}<div ref={end} />
      </div>
      <div className="task-composer-wrap">{!task && <div className="task-options"><select aria-label="Project" value={project} onChange={event => setProject(event.target.value)}><option value="">Select project…</option>{knownProjects.map(value => <option key={value} value={value}>{projectName(value)}</option>)}</select><button onClick={() => { void chooseProject().catch(err => setError(String(err))) }}>Browse</button><select aria-label="Permission mode" value={mode} onChange={event => setMode(event.target.value as PermissionMode)}><option value="safe">Safe · approve writes</option><option value="developer">Developer · project writes</option><option value="autonomous">Autonomous · sandboxed</option></select><select aria-label="Task intent" value={intent} onChange={event => setIntent(event.target.value as 'auto' | 'analyze' | 'implement')}><option value="auto">Automatic routing</option><option value="implement">Implement & verify</option><option value="analyze">Analysis only</option></select></div>}
        {!task && <div className="task-provider-options">{(['claude', 'codex'] as ProviderId[]).map(provider => <label key={provider}><input type="checkbox" checked={providers.includes(provider)} onChange={event => setProviders(previous => event.target.checked ? [...previous, provider] : previous.filter(v => v !== provider))} />{provider === 'codex' ? 'Codex / ChatGPT' : 'Claude'}</label>)}<span>Claude uses confined file tools. Codex uses its project sandbox. Autonomous requires Codex.</span></div>}
        {error && <p className="task-error" role="alert">{error}</p>}
        {editing && <p className="task-muted">Resubmitting as a new turn preserves the original message and audit history. <button onClick={() => { setEditing(false); setPrompt(''); setAttachments([]) }}>Cancel edit</button></p>}
        <div className="task-composer"><textarea ref={input} aria-label="Message Hydra" placeholder={active ? 'Task running — stop before sending a follow-up' : 'Ask Hydra to inspect, build, fix or explain…'} value={prompt} disabled={active || waiting || pending} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submit() } }} rows={3} maxLength={20000} />
          {!!attachments.length && <div className="task-attachments">{attachments.map((value, index) => <button key={index} onClick={() => setAttachments(previous => previous.filter((_, i) => i !== index))}>{value.name} ×</button>)}</div>}
          <div className="task-composer-actions"><label className="task-attach">＋ Attach text<input aria-label="Attach files" type="file" multiple disabled={active || waiting || pending} onChange={event => { if (event.target.files) void attach(event.target.files); event.target.value = '' }} /></label><span>{task?.permissionMode ?? mode} · {task?.providers.join(' + ') ?? providers.join(' + ')}</span>{active || waiting ? <button className="task-send" disabled={pending} onClick={() => { void command({ action: 'cancel' }) }}>■ Stop</button> : <button className="task-send" disabled={pending || !connected || !prompt.trim() || (!task && !providers.length)} onClick={() => { void submit() }}>{pending ? 'Starting…' : 'Send ↑'}</button>}</div></div>
        <p className="task-footnote">Codex uses a project sandbox; Claude uses confined file tools. Approval requests are visible here. Check observed evidence before relying on results.</p>
      </div>
    </main>
  </div>
}
