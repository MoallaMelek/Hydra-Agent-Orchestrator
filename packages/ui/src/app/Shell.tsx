import { useTheme, setTheme } from './preferences'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Cpu, Home, Menu, Moon, Plus, Search, Settings, Smartphone, Sun, X } from 'lucide-react'
import { HydraMark } from '../brand/HydraMark'
import { shallow } from '../api/store'
import { useApp, useAppState, useToasts, type Route } from './context'
import { useQuality } from './quality'
import { AddProjectDialog } from '../views/AddProjectDialog'
import { HomeView } from '../views/HomeView'
import { ProjectView } from '../views/ProjectView'
import { TaskView } from '../views/TaskView'
import { ProvidersView } from '../views/ProvidersView'
import { DevicesView } from '../views/DevicesView'
import { SettingsView } from '../views/SettingsView'
import { statusLabel } from '../lib/format'
import './command.css'

const CONNECTION = {
  connecting: { cls: 'idle', label: 'Connecting' },
  live: { cls: 'ok', label: 'Connected' },
  reconnecting: { cls: 'waiting', label: 'Reconnecting' },
  offline: { cls: 'failed', label: 'Engine offline' }
} as const

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

/** Per project: how many missions run and whether one waits for you (a small, stable slice). */
function useProjectStatus() {
  return useAppState((s) => {
    const out: Record<string, string> = {}
    for (const t of Object.values(s.tasks)) {
      if (t.archivedAt) continue
      if (t.status === 'waiting_input') out[t.projectId] = 'you'
      else if ((t.status === 'running' || t.status === 'queued') && out[t.projectId] !== 'you') out[t.projectId] = String(Number(out[t.projectId] ?? 0) + 1)
    }
    return out
  }, shallow)
}

/** Global find (/): missions and projects already loaded in this window. */
function Find() {
  const { go } = useApp()
  const tasks = useAppState((s) => s.tasks)
  const projects = useAppState((s) => s.projects)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); input.current?.focus() }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return []
    const p = projects.filter((x) => x.name.toLowerCase().includes(s)).slice(0, 3).map((x) => ({ key: x.id, label: x.name, meta: 'Project', route: { view: 'project', projectId: x.id } as Route }))
    const t = Object.values(tasks).filter((x) => x.title.toLowerCase().includes(s) || x.prompt.toLowerCase().includes(s)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 7)
      .map((x) => ({ key: x.id, label: x.title, meta: `${x.intent === 'analyze' ? 'Question' : 'Mission'} · ${statusLabel(x).label}`, route: { view: 'task', taskId: x.id } as Route }))
    return [...p, ...t]
  }, [q, tasks, projects])
  const pick = (r: Route) => { go(r); setQ(''); setOpen(false); input.current?.blur() }
  return <div className="frame__find" role="search">
    <Search size={14} aria-hidden />
    <input ref={input} type="search" placeholder="Find a mission or project" aria-label="Find a mission or project" value={q}
      onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
      onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); input.current?.blur() } if (e.key === 'Enter' && hits[0]) pick(hits[0].route) }} />
    <kbd aria-hidden>/</kbd>
    {open && q.trim() && <ul className="frame__results" aria-label="Matches">
      {hits.length ? hits.map((h) => <li key={h.key}><button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h.route)}><span className="truncate">{h.label}</span><span className="faint mono">{h.meta}</span></button></li>)
        : <li className="frame__none">No loaded mission matches. Project history searches everything.</li>}
    </ul>}
  </div>
}

export function Shell() {
  const { route, go, isRemote } = useApp()
  useLayoutEffect(() => { document.querySelector('.main')?.scrollTo({ top: 0 }); document.querySelectorAll<HTMLDetailsElement>('.frame details[open]').forEach((d) => { d.open = false }) }, [route])
  const connection = useAppState((s) => s.connection)
  const version = useAppState((s) => s.engineVersion)
  const error = useAppState((s) => s.error)
  const projects = useAppState((s) => s.projects)
  const status = useProjectStatus()
  const [adding, setAdding] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const theme = useTheme()
  const night = theme !== 'light'
  useQuality()
  const conn = CONNECTION[connection]
  const navigate = (r: Route) => { go(r); setNavOpen(false) }
  const current = route.view === 'project' ? projects.find((p) => p.id === route.projectId) : undefined
  const waiting = Object.values(status).filter((s) => s === 'you').length

  const nav = (r: Route, icon: React.ReactNode, label: string) => (
    <button className="frame__nav" aria-current={same(route, r) ? 'page' : undefined} onClick={() => navigate(r)}>{icon}<span>{label}</span></button>
  )

  return (
    <div className={`shell ${navOpen ? 'shell--nav-open' : ''}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="frame">
        <button className="frame__menu hx-btn hx-btn--ghost hx-btn--icon" aria-label={navOpen ? 'Close menu' : 'Menu'} aria-expanded={navOpen} aria-controls="frame-nav" onClick={() => setNavOpen(!navOpen)}>{navOpen ? <X size={16} /> : <Menu size={16} />}</button>
        <button className="frame__brand" onClick={() => navigate({ view: 'home' })} aria-label="Hydra home"><HydraMark size={22} /><b>Hydra</b></button>
        <details className="frame__switch">
          <summary aria-label="Switch project"><span className="eyebrow">Project</span><span className="truncate">{current?.name ?? 'All projects'}</span><ChevronDown size={14} aria-hidden /></summary>
          <div className="frame__menu-panel" role="menu">
            <button role="menuitem" className="frame__menu-item" onClick={() => navigate({ view: 'home' })}><span>All projects</span>{waiting > 0 && <span className="mono you">{waiting} need you</span>}</button>
            {[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
              const s = status[p.id]
              return <button role="menuitem" key={p.id} className="frame__menu-item" aria-current={current?.id === p.id || undefined} onClick={() => navigate({ view: 'project', projectId: p.id })}>
                <span className="truncate">{p.name}</span>{s === 'you' ? <span className="mono you">needs you</span> : s ? <span className="mono faint">{s} running</span> : null}
              </button>
            })}
            {!isRemote && <button role="menuitem" className="frame__menu-item frame__menu-add" onClick={() => setAdding(true)}><Plus size={14} aria-hidden />Add project</button>}
          </div>
        </details>
        <Find />
        <nav id="frame-nav" className="frame__navs" aria-label="Main">
          {nav({ view: 'home' }, <Home size={15} aria-hidden />, 'Home')}
          {nav({ view: 'providers' }, <Cpu size={15} aria-hidden />, 'AI accounts')}
          {!isRemote && nav({ view: 'devices' }, <Smartphone size={15} aria-hidden />, 'Phone')}
          {nav({ view: 'settings' }, <Settings size={15} aria-hidden />, 'Settings')}
        </nav>
        <span className={`frame__conn s-${conn.cls}`} title={version ? `Engine v${version}${isRemote ? ' · remote' : ''}` : undefined}><i aria-hidden />{conn.label}</span>
        <button className="hx-btn hx-btn--ghost hx-btn--icon" aria-label={night ? 'Switch to Day' : 'Switch to Night'} title={night ? 'Day' : 'Night'} onClick={() => setTheme(night ? 'light' : 'dark')}>{night ? <Sun size={15} /> : <Moon size={15} />}</button>
      </header>
      <main className="main" id="main-content" tabIndex={-1}>
        {error && <div className="page"><div className="hx-callout hx-callout--bad" role="alert">{error}</div></div>}
        {route.view === 'home' && <HomeView onAddProject={() => setAdding(true)} />}
        {route.view === 'project' && <ProjectView key={route.projectId} projectId={route.projectId} />}
        {route.view === 'task' && <TaskView key={route.taskId} taskId={route.taskId} />}
        {route.view === 'providers' && <ProvidersView />}
        {route.view === 'devices' && <DevicesView />}
        {route.view === 'settings' && <SettingsView />}
      </main>
      <AddProjectDialog open={adding} onClose={() => setAdding(false)} />
      <Toasts />
    </div>
  )
}

function Toasts() {
  const toasts = useToasts()
  return (
    <div className="hx-toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`hx-toast ${t.tone === 'bad' ? 'hx-toast--bad' : ''}`}>{t.text}</div>)}
    </div>
  )
}
