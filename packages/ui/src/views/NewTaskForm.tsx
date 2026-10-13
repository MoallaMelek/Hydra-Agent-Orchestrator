import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { AutonomyMode, ProviderId, Task } from '@hydra/protocol'
import { Button, Callout, Field, Segmented } from '../design/components'
import { useApp } from '../app/context'
import { MODE_INFO } from '../lib/format'

const DEFAULT_BUDGET = { safe: { cost: 2, minutes: 30 }, developer: { cost: 5, minutes: 60 }, autonomous: { cost: 15, minutes: 120 } }

export function NewTaskForm({ projectId, isGit }: { projectId: string; isGit: boolean }) {
  const { state, run, go } = useApp()
  const ready = state.providers.filter((p) => p.installed && p.problems.length === 0).map((p) => p.id)
  const [prompt, setPrompt] = useState('')
  const [intent, setIntent] = useState<'change' | 'analyze'>(isGit ? 'change' : 'analyze')
  const [mode, setMode] = useState<AutonomyMode>('safe')
  const defaults = useMemo(() => ({
    planner: (ready.includes('claude') ? 'claude' : ready[0] ?? 'claude') as ProviderId,
    implementer: (ready.includes('codex') ? 'codex' : ready[0] ?? 'codex') as ProviderId,
    reviewer: (ready.includes('claude') ? 'claude' : ready[0] ?? 'claude') as ProviderId
  }), [ready.join(',')])
  const [assignment, setAssignment] = useState(defaults)
  const [cost, setCost] = useState<number | ''>('')
  const [minutes, setMinutes] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)

  const label = (id: string) => state.providers.find((p) => p.id === id)?.displayName ?? id
  const select = (role: keyof typeof assignment, hint: string) => (
    <Field label={role === 'planner' ? 'Planner' : role === 'implementer' ? 'Implementer' : 'Reviewer'} hint={hint} htmlFor={`role-${role}`}>
      <select id={`role-${role}`} className="hx-select" value={assignment[role]} onChange={(e) => setAssignment({ ...assignment, [role]: e.target.value as ProviderId })}>
        {state.providers.map((p) => <option key={p.id} value={p.id} disabled={!ready.includes(p.id)}>{p.displayName}{ready.includes(p.id) ? '' : ' (not ready)'}</option>)}
      </select>
    </Field>
  )

  const submit = async () => {
    setBusy(true)
    const budget: Record<string, number> = {}
    if (cost !== '') budget.maxCostUsd = Number(cost)
    if (minutes !== '') budget.maxWallMinutes = Number(minutes)
    const ack = await run({ type: 'task.create', projectId, prompt, intent, mode, assignment, ...(Object.keys(budget).length ? { budget } : {}) })
    setBusy(false)
    if (ack.ok) { setPrompt(''); go({ view: 'task', taskId: (ack.result as Task).id }) }
  }

  return (
    <div className="composer">
      <Field label="What should happen?" htmlFor="task-prompt">
        <textarea id="task-prompt" className="hx-textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={intent === 'change' ? 'Describe the change, e.g. "Cart totals ignore quantity; fix total() and add a test."' : 'Ask about the code, e.g. "How is authentication wired?"'}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) void submit() }} />
      </Field>
      <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Field label="Kind">
          <Segmented label="Task kind" value={intent} onChange={setIntent} options={[{ value: 'change', label: 'Change code' }, { value: 'analyze', label: 'Ask a question' }]} />
        </Field>
        {intent === 'change' && (
          <Field label="Autonomy">
            <Segmented label="Autonomy mode" value={mode} onChange={setMode} options={(['safe', 'developer', 'autonomous'] as const).map((m) => ({ value: m, label: MODE_INFO[m].label }))} />
          </Field>
        )}
      </div>
      {intent === 'change' && <p className="faint" style={{ fontSize: 12.5, marginTop: -6 }}>{MODE_INFO[mode].detail}</p>}
      {intent === 'change' && !isGit && <Callout tone="warn">This folder is not a git repository. Change tasks need git so Hydra can isolate work; run <code>git init</code> and commit first.</Callout>}
      {intent === 'change' ? (
        <div className="composer__row">
          {select('planner', 'Reads the code, writes the plan')}
          {select('implementer', 'Edits files in the isolated worktree')}
          {select('reviewer', assignment.reviewer === assignment.implementer ? 'Same provider as the implementer: less independent' : 'Independent review of the diff + real test results')}
        </div>
      ) : <div className="composer__row">{select('planner', 'Answers using read-only access')}</div>}
      <div className="composer__row">
        <Field label="Cost limit (USD)" htmlFor="budget-cost" hint={`Default $${DEFAULT_BUDGET[mode].cost}. Codex usage is limited by tokens (its CLI reports no price).`}>
          <input id="budget-cost" className="hx-input" type="number" min={0.1} step={0.5} placeholder={String(DEFAULT_BUDGET[mode].cost)} value={cost} onChange={(e) => setCost(e.target.value === '' ? '' : Number(e.target.value))} />
        </Field>
        <Field label="Active time limit (min)" htmlFor="budget-min" hint={`Default ${DEFAULT_BUDGET[mode].minutes}. Waiting for you does not count.`}>
          <input id="budget-min" className="hx-input" type="number" min={1} step={5} placeholder={String(DEFAULT_BUDGET[mode].minutes)} value={minutes} onChange={(e) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))} />
        </Field>
        <div className="col" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" size="lg" icon={<Sparkles size={16} />} busy={busy} disabled={!prompt.trim() || (intent === 'change' && !isGit) || !ready.length} onClick={() => void submit()}>
            {intent === 'change' ? 'Start task' : 'Ask'}
          </Button>
        </div>
      </div>
      {!ready.length && <Callout tone="bad">No agent is ready. Open <b>Agents &amp; providers</b> to see what to install or sign in to ({label('claude')}, {label('codex')}).</Callout>}
    </div>
  )
}
