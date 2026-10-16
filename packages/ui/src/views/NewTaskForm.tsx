import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ShieldAlert, Sparkles } from 'lucide-react'
import { routeRequest, type AutonomyMode, type DepthChoice, type ProviderId, type Task } from '@hydra/protocol'
import { Button, Callout, Field, Segmented } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { MODE_INFO } from '../lib/format'

const DEFAULT_BUDGET = { safe: { cost: 2, minutes: 30 }, developer: { cost: 5, minutes: 60 }, autonomous: { cost: 15, minutes: 120 } }

export const DEPTH_LABEL = { fast: 'Quick answer', standard: 'Code question', deep: 'Full change' } as const
const DEPTH_HINT = {
  fast: 'One agent replies right away.',
  standard: 'One agent reads the code it needs, then replies.',
  deep: 'Hydra plans, edits an isolated copy, reviews, runs your tests, then asks you to approve.'
} as const

/** One box for questions and changes. Hydra picks how to handle it (Auto) unless you choose. */
export function NewTaskForm({ projectId, isGit }: { projectId: string; isGit: boolean }) {
  const { run, go, store } = useApp()
  const providers = useAppState((s) => s.providers)
  const ready = providers.filter((p) => p.installed && p.problems.length === 0).map((p) => p.id)
  const [prompt, setPrompt] = useState('')
  const [choice, setChoice] = useState<DepthChoice>('auto')
  const [mode, setMode] = useState<AutonomyMode>('safe')
  const defaults = useMemo(() => ({
    planner: (ready.includes('claude') ? 'claude' : ready[0] ?? 'claude') as ProviderId,
    implementer: (ready.includes('codex') ? 'codex' : ready[0] ?? 'codex') as ProviderId,
    reviewer: (ready.includes('claude') ? 'claude' : ready[0] ?? 'claude') as ProviderId
  }), [ready.join(',')])
  const [assignment, setAssignment] = useState(defaults)
  // Hydra's suggestion (rule or your history). Applied until you pick agents yourself.
  const [suggestion, setSuggestion] = useState<{ strategy: string; basis: 'history' | 'rule'; reason: string; assignment: typeof defaults } | null>(null)
  const [picked, setPicked] = useState(false)
  const [cost, setCost] = useState<number | ''>('')
  const [minutes, setMinutes] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const warmed = useRef(0)

  const route = routeRequest(prompt, choice)
  // Mirrors the engine: without git, Auto answers instead of changing code.
  const depth = route.depth === 'deep' && !isGit && route.auto ? 'standard' : route.depth
  const isChange = depth === 'deep'
  const effectiveMode: AutonomyMode = isChange && route.risk === 'high' ? 'safe' : mode

  const label = (id: string) => providers.find((p) => p.id === id)?.displayName ?? id
  const select = (role: keyof typeof assignment, hint: string) => (
    <Field label={role === 'planner' ? (isChange ? 'Planner' : 'Answers with') : role === 'implementer' ? 'Implementer' : 'Reviewer'} hint={hint} htmlFor={`role-${role}`}>
      <select id={`role-${role}`} className="hx-select" value={assignment[role]} onChange={(e) => { setPicked(true); setAssignment({ ...assignment, [role]: e.target.value as ProviderId }) }}>
        {providers.map((p) => <option key={p.id} value={p.id} disabled={!ready.includes(p.id)}>{p.displayName}{ready.includes(p.id) ? '' : ' (not ready)'}</option>)}
      </select>
    </Field>
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      void store.transport.execute({ type: 'agents.recommend', prompt, depth: choice }).then((ack) => {
        if (!ack.ok) return
        const next = ack.result as NonNullable<typeof suggestion>
        setSuggestion(next)
        if (!picked) setAssignment(next.assignment)
      }).catch(() => {})
    }, 350)
    return () => clearTimeout(timer)
  }, [prompt, choice, picked, store])

  // Start an answering agent while the user types, so the reply begins sooner.
  const prewarm = () => {
    if (Date.now() - warmed.current < 60_000 || !ready.includes('claude')) return
    warmed.current = Date.now()
    void run({ type: 'agent.prewarm', projectId })
  }

  const submit = async () => {
    setBusy(true)
    const budget: Record<string, number> = {}
    if (cost !== '') budget.maxCostUsd = Number(cost)
    if (minutes !== '') budget.maxWallMinutes = Number(minutes)
    const ack = await run({ type: 'task.create', projectId, prompt, depth: choice, mode, assignment, ...(Object.keys(budget).length ? { budget } : {}) })
    setBusy(false)
    if (ack.ok) { setPrompt(''); setChoice('auto'); go({ view: 'task', taskId: (ack.result as Task).id }) }
  }

  return (
    <div className="composer">
      <Field label="Ask a question or describe a change" htmlFor="task-prompt">
        <textarea id="task-prompt" className="hx-textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} onFocus={prewarm}
          placeholder='e.g. "How is authentication wired?" or "Cart totals ignore quantity. Fix total() and add a test."'
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) void submit() }} />
      </Field>
      <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <Field label="How Hydra handles it">
          <Segmented label="Handling" value={choice} onChange={setChoice} options={[
            { value: 'auto', label: 'Auto' }, { value: 'fast', label: DEPTH_LABEL.fast }, { value: 'standard', label: DEPTH_LABEL.standard }, { value: 'deep', label: DEPTH_LABEL.deep }
          ]} />
        </Field>
        {isChange && (
          <Field label="How much freedom">
            <Segmented label="Autonomy mode" value={effectiveMode} onChange={setMode} options={(['safe', 'developer', 'autonomous'] as const).map((m) => ({ value: m, label: MODE_INFO[m].label }))} />
          </Field>
        )}
      </div>
      {prompt.trim() && (
        <p className="route-preview" role="status">
          <b>{choice === 'auto' ? `Auto → ${DEPTH_LABEL[depth]}` : DEPTH_LABEL[depth]}.</b>{' '}
          {depth !== route.depth ? 'This folder is not a git repository with commits, so Hydra will answer here.' : choice === 'auto' ? route.reason : DEPTH_HINT[depth]}
          {isChange && ` ${MODE_INFO[effectiveMode].detail}`}
        </p>
      )}
      {isChange && route.risk === 'high' && <Callout tone="warn" icon={<ShieldAlert size={16} />}>This looks risky (deleting data, secrets, production or force-push). Hydra will show you the plan before anything is written, whatever mode you choose.</Callout>}
      {choice === 'deep' && !isGit && <Callout tone="warn">This folder is not a git repository. Changes need git so Hydra can isolate work; run <code>git init</code> and commit first.</Callout>}
      <button type="button" className="chat__toggle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
        {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Agents and limits
        <span className="faint" style={{ marginLeft: 6 }}>
          {isChange ? `${label(assignment.planner)} plans · ${label(assignment.implementer)} codes · ${label(assignment.reviewer)} reviews` : `${label(assignment.planner)} answers`} · up to ${cost === '' ? DEFAULT_BUDGET[effectiveMode].cost : cost}
        </span>
      </button>
      {advanced && (isChange ? (
        <div className="composer__row">
          {select('planner', 'Reads the code, writes the plan')}
          {select('implementer', 'Edits files in the isolated worktree')}
          {select('reviewer', assignment.reviewer === assignment.implementer ? 'Same provider as the implementer: less independent' : 'Independent review of the diff + real test results')}
        </div>
      ) : <div className="composer__row">{select('planner', 'Replies using read-only access')}</div>)}
      {advanced && suggestion && (
        <p className="faint" style={{ fontSize: 12.5, marginTop: -4 }}>
          {picked ? 'Your choice. ' : 'Suggested. '}{suggestion.reason}{' '}
          {suggestion.basis === 'rule' ? '(A rule, not yet your history.)' : '(From your own finished tasks.)'}
          {picked && <> <button type="button" className="chat__toggle" onClick={() => { setPicked(false); setAssignment(suggestion.assignment) }}>Use the suggestion</button></>}
        </p>
      )}
      {advanced && <div className="composer__row">
        <Field label="Cost limit (USD)" htmlFor="budget-cost" hint={`Default $${DEFAULT_BUDGET[effectiveMode].cost}. Codex usage is limited by tokens (its CLI reports no price).`}>
          <input id="budget-cost" className="hx-input" type="number" min={0.1} step={0.5} placeholder={String(DEFAULT_BUDGET[effectiveMode].cost)} value={cost} onChange={(e) => setCost(e.target.value === '' ? '' : Number(e.target.value))} />
        </Field>
        <Field label="Active time limit (min)" htmlFor="budget-min" hint={`Default ${DEFAULT_BUDGET[effectiveMode].minutes}. Waiting for you does not count.`}>
          <input id="budget-min" className="hx-input" type="number" min={1} step={5} placeholder={String(DEFAULT_BUDGET[effectiveMode].minutes)} value={minutes} onChange={(e) => setMinutes(e.target.value === '' ? '' : Number(e.target.value))} />
        </Field>
      </div>}
      <div className="composer__row" style={{ justifyContent: 'flex-end' }}>
        <div className="col" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" size="lg" icon={<Sparkles size={16} />} busy={busy} disabled={!prompt.trim() || (choice === 'deep' && !isGit) || !ready.length} onClick={() => void submit()}>
            {isChange ? 'Start change' : 'Ask'}
          </Button>
        </div>
      </div>
      {!ready.length && <Callout tone="bad">No agent is ready. Open <b>Agents &amp; providers</b> to see what to install or sign in to ({label('claude')}, {label('codex')}).</Callout>}
    </div>
  )
}
