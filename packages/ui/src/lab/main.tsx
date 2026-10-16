import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '../design/tokens.css'
import '../design/base.css'
import '../design/components.css'
import '../views/app.css'
import { EngineStore } from '../api/store'
import { AppProvider, useApp } from '../app/context'
import { Shell } from '../app/Shell'
import { FixtureTransport } from './fixtureTransport'
import { FixtureWorld } from './world'
import { SCENARIOS, type ScenarioId } from './scenarios'
import { runBench } from './bench'

/**
 * Hydra interface lab — SIMULATED FIXTURE DATA ONLY. Development builds and benchmarks.
 * Not part of the production bundle (vite builds index.html only).
 */

const params = new URLSearchParams(location.search)
const scenario = (params.get('scenario') ?? 'complex') as ScenarioId
const speed = Math.max(0.1, Number(params.get('speed') ?? 1))
const bench = params.get('bench') === '1'

const world = new FixtureWorld()
const transport = new FixtureTransport(world)
world.slots = Number(params.get('slots') ?? 3)
const sleep = (simMs: number) => new Promise<void>((resolve) => setTimeout(() => { world.now += simMs; resolve() }, simMs / speed))
const store = new EngineStore(transport)

function Boot({ taskId }: { taskId: Promise<string> }) {
  const { go } = useApp()
  useEffect(() => { void taskId.then((id) => { if (params.get('view') !== 'home') go({ view: 'task', taskId: id }) }) }, [go, taskId])
  return null
}

const banner = (
  <div className="lab-banner" role="note">
    SIMULATED FIXTURE · {SCENARIOS[scenario]?.title ?? scenario} · not real agent activity
  </div>
)

async function start() {
  // The scenario creates its projects and tasks synchronously, before the first snapshot.
  const taskId = SCENARIOS[scenario].run({ world, sleep, transport })
  await store.start()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider store={store} host={{}}>
        {banner}
        <Shell />
        <Boot taskId={taskId} />
      </AppProvider>
    </StrictMode>
  )
  if (bench) void runBench(world, taskId)
}

void start()
