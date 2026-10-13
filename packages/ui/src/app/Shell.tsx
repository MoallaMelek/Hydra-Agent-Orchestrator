import { useState } from 'react'
import { Cpu, FolderGit2, Menu, Moon, Plus, Settings, Smartphone, Sun } from 'lucide-react'
import { HydraMark } from '../brand/HydraMark'
import { Badge, Button } from '../design/components'
import { useApp, type Route } from './context'
import { AddProjectDialog } from '../views/AddProjectDialog'
import { HomeView } from '../views/HomeView'
import { ProjectView } from '../views/ProjectView'
import { TaskView } from '../views/TaskView'
import { ProvidersView } from '../views/ProvidersView'
import { DevicesView } from '../views/DevicesView'
import { SettingsView } from '../views/SettingsView'

const CONNECTION = {
  connecting: { tone: 'neutral', label: 'Connecting' },
  live: { tone: 'ok', label: 'Live' },
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

export function Shell() {
  const { state, route, go, toasts } = useApp()
  const [adding, setAdding] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [theme, toggleTheme] = useTheme()
  const conn = CONNECTION[state.connection]
  const tasks = Object.values(state.tasks)
  const navigate = (r: Route) => { go(r); setNavOpen(false) }

  const item = (r: Route, icon: React.ReactNode, label: string, meta?: React.ReactNode) => (
    <button className="nav-item" aria-current={same(route, r) ? 'page' : undefined} onClick={() => navigate(r)}>
      {icon}<span className="truncate">{label}</span>{meta}
    </button>
  )

  return (
    <div className={`shell ${navOpen ? 'shell--nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Navigation">
        <div className="sidebar__brand">
          <HydraMark size={26} />
          <div className="col" style={{ gap: 0 }}><b>Hydra</b><small>v{state.engineVersion || '2'}</small></div>
        </div>
        <div className="sidebar__scroll">
          <div className="sidebar__section">
            <div className="sidebar__heading">Projects <Button variant="ghost" size="sm" icon={<Plus size={14} />} aria-label="Add project" onClick={() => setAdding(true)} /></div>
            {state.projects.length === 0 && <p className="faint" style={{ padding: '4px 8px', fontSize: 12 }}>No projects yet.</p>}
            {[...state.projects].sort((a, b) => a.name.localeCompare(b.name)).map((project) => {
              const waiting = tasks.some((t) => t.projectId === project.id && t.status === 'waiting_input')
              const active = tasks.filter((t) => t.projectId === project.id && (t.status === 'running' || t.status === 'queued')).length
              return <div key={project.id}>{item({ view: 'project', projectId: project.id }, <FolderGit2 size={15} />, project.name,
                waiting ? <span className="nav-item__dot" title="Needs your decision" /> : active ? <span className="nav-item__meta">{active} running</span> : null)}</div>
            })}
          </div>
          <div className="sidebar__section">
            <div className="sidebar__heading">System</div>
            {item({ view: 'providers' }, <Cpu size={15} />, 'Agents & providers')}
            {item({ view: 'devices' }, <Smartphone size={15} />, 'Remote devices')}
            {item({ view: 'settings' }, <Settings size={15} />, 'Settings')}
          </div>
        </div>
        <div className="sidebar__foot">
          <Badge tone={conn.tone} live={state.connection === 'reconnecting'}>{conn.label}</Badge>
          <Button variant="ghost" size="sm" aria-label="Toggle theme" icon={theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} onClick={toggleTheme} />
        </div>
      </aside>
      <main className="main">
        <div className="mobile-bar">
          <Button variant="ghost" size="sm" aria-label="Menu" icon={<Menu size={16} />} onClick={() => setNavOpen(!navOpen)} />
          <HydraMark size={20} /><b>Hydra</b><span className="grow" /><Badge tone={conn.tone}>{conn.label}</Badge>
        </div>
        {state.error && <div className="page"><div className="hx-callout hx-callout--bad">{state.error}</div></div>}
        {route.view === 'home' && <HomeView onAddProject={() => setAdding(true)} />}
        {route.view === 'project' && <ProjectView projectId={route.projectId} />}
        {route.view === 'task' && <TaskView taskId={route.taskId} />}
        {route.view === 'providers' && <ProvidersView />}
        {route.view === 'devices' && <DevicesView />}
        {route.view === 'settings' && <SettingsView />}
      </main>
      <AddProjectDialog open={adding} onClose={() => setAdding(false)} />
      <div className="hx-toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`hx-toast ${t.tone === 'bad' ? 'hx-toast--bad' : ''}`}>{t.text}</div>)}
      </div>
    </div>
  )
}
