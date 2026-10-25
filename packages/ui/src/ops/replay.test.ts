import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FixtureWorld } from '../lab/world'
import { buildTrace } from './model'
import { RelayTrace } from './RelayTrace'
import { TraceList } from './TraceList'
import { Workflow } from './Workflow'

describe('historical replay truthfulness', () => {
  it('does not present an intentionally failing baseline comparison as failed final verification', () => {
    const world = new FixtureWorld()
    const project = world.addProject('verified')
    const task = world.createTask(project.id, 'Fix the failing test')
    world.check(task.id, 'npm test', 'verify', 0, 100)
    world.now += 200
    world.check(task.id, 'npm test', 'demo_base', 1, 100)
    const trace = buildTrace({ task: world.tasks.get(task.id)!, runs: [], evidence: world.evidence, now: world.now })
    const output = renderToStaticMarkup(createElement(Workflow, { trace, onSelect: () => {} }))
    expect(output).toContain('Execution finished')
    expect(output).not.toContain('Needs attention')
    expect(output).toContain('npm test')
  })
  it('shows a recorded successful execution as running before its recorded end, in both diagram and list', () => {
    const world = new FixtureWorld()
    const project = world.addProject('replay')
    const task = world.createTask(project.id, 'Inspect replay')
    world.beginStage(task.id, 'plan')
    const run = world.startRun(task.id, 'plan', 'planner', 'claude')
    const start = world.now
    world.now += 1000
    world.endRun(run.id); world.endStage(task.id)
    const trace = buildTrace({ task: world.tasks.get(task.id)!, runs: [...world.runs.values()], evidence: [], now: world.now })
    const before = renderToStaticMarkup(createElement(RelayTrace, { trace, selection: null, onSelect: () => {}, cursor: start + 500 }))
    expect(before).toContain('relay__seg--running')
    expect(before).toContain('in progress')
    expect(before).not.toContain(', done')
    const list = renderToStaticMarkup(createElement(TraceList, { trace, cursor: start + 500, onSelect: () => {} }))
    expect(list).toContain('in progress')
    expect(list).toContain('trace-list__row--running')
    const after = renderToStaticMarkup(createElement(RelayTrace, { trace, selection: null, onSelect: () => {}, cursor: world.now }))
    expect(after).toContain(', done')
  })
})
