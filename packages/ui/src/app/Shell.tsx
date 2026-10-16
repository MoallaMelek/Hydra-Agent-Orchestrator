import { useState } from 'react'
import { Cpu, FolderGit2, LayoutDashboard, Menu, Moon, Plus, Settings, Smartphone, Sun } from 'lucide-react'
import { HydraMark } from '../brand/HydraMark'
import { Badge, Button } from '../design/components'
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

const CONNECTION = {
  connecting: { tone: 'neutral', label: 'Connecting' },
  live: { tone: 'ok', label: 'Connected' },
  reconnecting: { tone: 'warn', label: 'Reconnecting' },
  offline: { tone: 'bad', label: 'Offline' }
} as const

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('hydra.theme') ?? 'dark' } catch { return 'dark' }
  })
  document.documentElement.dataset.theme = theme
  return [theme, () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('hydra.theme', next) } catch { /* private mode */ }
    setTheme(next)
  }]
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b)

/** Per project: how many tasks run and whether one waits for you (a small, stable slice). */
function useProjectStatus() {
  return useAppState((s) => {
    const out: Record<string, string> = {}
    for (const t of Object.values(s.tasks)) {
      if (t.status === 'waiting_input') out[t.projectId] = 'you'
      else if ((t.status === 'running' || t.status === 'queued') && out[t.projectId] !== 'you') out[t.projectId] = String(Number(out[t.projectId] ?? 0) + 1)
    }
    return out
  }, shallow)
}

export function Shell() {
  const { route, go, isRemote } = useApp()
  const connection = useAppState((s) => s.connection)
  const version = useAppState((s) => s.engineVersion)
  const error = useAppState((s) => s.error)
  const projects = useAppState((s) => s.projects)
  const status = useProjectStatus()
  const [adding, setAdding] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [theme, toggleTheme] = useTheme()
  useQuality()
  const conn = CONNECTION[connection]
  const navigate = (r: Route) => { go(r); setNavOpen(false) }

  const item = (r: Route, icon: React.ReactNode, label: string, meta?: React.ReactNode) => (
    <button className="nav-item" aria-current={same(route, r) ? 'page' : undefined} onClick={() => navigate(r)}>
      {icon}<span className="truncate">{label}</span>{meta}
    </button>
  )

  return (
    <div className={`shell ${navOpen ? 'shell--nav-open' : ''}`}>
      <aside className="rail" aria-label="Navigation">
        <div className="rail__brand">
          <HydraMark size={24} />
          <b>Hydra</b>
          <small className="faint">{version ? `v${version}` : ''}</small>
        </div>
        <div className="rail__scroll">
          <div className="rail__section">
            {item({ view: 'home' }, <LayoutDashboard size={15} />, 'Command center')}
          </div>
          <div className="rail__section">
            <div className="rail__heading">Projects {!isRemote && <Button variant="ghost" size="sm" icon={<Plus size={14} />} aria-label="Add project" onClick={() => setAdding(true)} />}</div>
            {projects.length === 0 && <p className="faint" style={{ padding: '4px 8px', fontSize: 12 }}>No projects yet.</p>}
            {[...projects].sort((a, b) => a.name.localeCompare(b.name)).map((project) => {
              const s = status[project.id]
              return <div key={project.id}>{item({ view: 'project', projectId: project.id }, <FolderGit2 size={15} />, project.name,
                s === 'you' ? <span className="nav-item__you" title="Needs your decision">needs you</span> : s ? <span className="nav-item__meta num">{s} running</span> : null)}</div>
            })}
          </div>
          <div className="rail__section">
            <div className="rail__heading">System</div>
            {item({ view: 'providers' }, <Cpu size={15} />, 'Agents & providers')}
            {!isRemote && item({ view: 'devices' }, <Smartphone size={15} />, 'Remote devices')}
            {item({ view: 'settings' }, <Settings size={15} />, 'Settings')}
          </div>
        </div>
        <div className="rail__foot">
          <Badge tone={conn.tone} live={connection === 'reconnecting'}>{conn.label}</Badge>
          <Button variant="ghost" size="sm" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} onClick={toggleTheme} />
        </div>
      </aside>
      <main className="main">
        <div className="mobile-bar">
          <Button variant="ghost" size="sm" aria-label="Menu" icon={<Menu size={16} />} onClick={() => setNavOpen(!navOpen)} />
          <HydraMark size={20} /><b>Hydra</b><span className="grow" /><Badge tone={conn.tone}>{conn.label}</Badge>
        </div>
        {error && <div className="page"><div className="hx-callout hx-callout--bad">{error}</div></div>}
        {route.view === 'home' && <HomeView onAddProject={() => setAdding(true)} />}
        {route.view === 'project' && <ProjectView projectId={route.projectId} />}
        {route.view === 'task' && <TaskView taskId={route.taskId} />}
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
