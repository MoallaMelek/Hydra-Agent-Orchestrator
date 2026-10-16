import { useState } from 'react'
import type { AgentRunInfo, Evidence, RunActivity, Task } from '@hydra/protocol'
import { Badge, Button } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { Markdown } from '../lib/markdown'
import { duration, money, shortSha, tokens } from '../lib/format'
import { filesOf, passed, shortTarget, type Baton, type Segment, type Trace } from './model'
import type { Selection } from './RelayTrace'

const KIND_WORD: Record<RunActivity['kind'], string> = { read: 'Read', search: 'Search', edit: 'Edit', command: 'Run', other: 'Tool' }
const PHASE: Record<Evidence['phase'], string> = { pre_review: 'Before review', verify: 'Verification', demo_base: 'Original commit', demo_final: 'Result' }

interface Props {
  trace: Trace
  task: Task
  runs: AgentRunInfo[]
  evidence: Evidence[]
  selection: Selection
  onSelect: (s: Selection) => void
}

/** Zoom from the whole task to one agent, one operation, one artifact, and its evidence. */
export function Inspector({ trace, task, runs, evidence, selection, onSelect }: Props) {
  if (!selection) return <aside className="inspector"><p className="faint">Select a lane, a bar or an artifact in the trace to see its details.</p></aside>
  if (selection.kind === 'lane') return <LaneDetail trace={trace} task={task} runs={runs} lane={selection.id} onSelect={onSelect} />
  if (selection.kind === 'baton') {
    const baton = trace.batons.find((b) => b.id === selection.id)
    return baton ? <BatonDetail baton={baton} task={task} evidence={evidence} trace={trace} /> : <Gone />
  }
  const segment = trace.segments.find((s) => s.id === selection.id)
  if (!segment) return <Gone />
  if (segment.ref.type === 'run') {
    const run = runs.find((r) => r.id === segment.id)
    return run ? <RunDetail run={run} segment={segment} task={task} trace={trace} /> : <Gone />
  }
  if (segment.ref.type === 'evidence') {
    const e = evidence.find((x) => x.id === segment.id)
    // Keyed: a full log fetched for one check must never show under another.
    return e ? <EvidenceDetail key={e.id} evidence={e} /> : <Gone />
  }
  return <StateDetail segment={segment} task={task} />
}

const Gone = () => <aside className="inspector"><p className="faint">This item is no longer in view.</p></aside>

function Head({ kind, title, basis, tone }: { kind: string; title: string; basis?: 'observed' | 'inferred'; tone?: 'ok' | 'bad' | 'warn' | 'accent' | 'neutral' }) {
  return (
    <header className="inspector__head">
      <span className="inspector__kind">{kind}</span>
      <h3 className="inspector__title">{title}</h3>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {basis && <Badge tone={basis === 'observed' ? 'neutral' : 'info'} plain title={basis === 'observed' ? 'Reported by the engine' : 'Deduced by the interface from what the engine reported'}>{basis === 'observed' ? 'Observed' : 'Inferred'}</Badge>}
        {tone && <Badge tone={tone}>{tone === 'ok' ? 'Done' : tone === 'bad' ? 'Failed' : tone === 'accent' ? 'In progress' : tone === 'warn' ? 'Waiting' : 'Stopped'}</Badge>}
      </div>
    </header>
  )
}

const toneOf = (s: Segment['status']) => (s === 'ok' ? 'ok' : s === 'failed' ? 'bad' : s === 'running' ? 'accent' : s === 'waiting' ? 'warn' : 'neutral') as 'ok' | 'bad' | 'accent' | 'warn' | 'neutral'

function RunDetail({ run, segment, task, trace }: { run: AgentRunInfo; segment: Segment; task: Task; trace: Trace }) {
  const live = useAppState((s) => s.activity[run.id])
  const output = useAppState((s) => (run.status === 'running' ? s.output[run.id] : undefined))
  const activity = run.status === 'running' ? live ?? run.activity ?? [] : run.activity ?? []
  const files = filesOf(activity)
  const lane = trace.lanes.find((l) => l.id === segment.lane)
  const ended = run.endedAt ? Date.parse(run.endedAt) : trace.now
  const tokenCount = run.usage.inputTokens + run.usage.outputTokens
  const [all, setAll] = useState(false)
  const calls = all ? activity : activity.slice(-30)
  return (
    <aside className="inspector">
      <Head kind="Agent run" title={segment.label} basis="observed" tone={toneOf(segment.status)} />
      <dl className="hx-kv">
        <dt>Role</dt><dd>{lane?.title} · {lane?.duty}</dd>
        <dt>Agent</dt><dd>{lane?.actor}{run.model ? <span className="faint mono"> · {run.model}</span> : null}</dd>
        <dt>Time</dt><dd className="num">{new Date(run.startedAt).toLocaleTimeString()} · {duration(Math.max(0, ended - Date.parse(run.startedAt)))}{run.status === 'running' ? ' so far' : ''}</dd>
        <dt>Usage</dt><dd className="num">{tokens(tokenCount)} tokens · {run.usage.unpricedTokens ? 'cost not reported by this CLI' : money(run.usage.costUsd)}</dd>
        {task.selection && <><dt>Why this agent</dt><dd>{task.selection.basis === 'suggested' ? 'Hydra\'s suggestion' : 'Your choice'}: {task.selection.reason}</dd></>}
      </dl>
      {run.error && <p className="inspector__error">{run.error}</p>}
      {(files.modified.length > 0 || files.inspected.length > 0 || files.commands.length > 0) && (
        <section className="inspector__block">
          <h4>Files and commands</h4>
          {files.modified.length > 0 && <FileList label="Modified" items={files.modified} tone="edit" />}
          {files.inspected.length > 0 && <FileList label="Inspected" items={files.inspected} tone="read" />}
          {files.commands.length > 0 && <FileList label="Ran" items={files.commands} tone="command" />}
        </section>
      )}
      <section className="inspector__block">
        <h4>Tool calls <span className="faint num">{activity.length}</span></h4>
        {activity.length === 0 ? <p className="faint">{run.activity === undefined ? 'Not recorded for runs before this version.' : 'No tool calls reported (yet).'}</p> : (
          <ol className="calls">
            {calls.map((a, i) => (
              <li key={`${a.at}-${i}`} className={`calls__item k-${a.kind}`}>
                <span className="calls__t num">+{duration(Math.max(0, Date.parse(a.at) - Date.parse(run.startedAt)))}</span>
                <span className="calls__k">{KIND_WORD[a.kind]}</span>
                <span className="calls__target mono truncate" title={a.target}>{shortTarget(a.target, 90)}</span>
              </li>
            ))}
          </ol>
        )}
        {activity.length > 30 && <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show the latest 30' : `Show all ${activity.length}`}</Button>}
      </section>
      <section className="inspector__block">
        <h4>Output</h4>
        {/* Only the latest part: re-laying out tens of kilobytes on every update would cost frames. */}
        <pre className="hx-log" style={{ maxHeight: 220 }}>{tail((output ?? run.tail) || '(no text output)')}</pre>
        <p className="faint" style={{ fontSize: 11.5 }}>Agent output is untrusted text, shown as written (secrets redacted by the engine). It is not the model's private reasoning.</p>
      </section>
    </aside>
  )
}

const tail = (text: string, max = 4000) => (text.length > max ? `…${text.slice(-max)}` : text)

function FileList({ label, items, tone }: { label: string; items: string[]; tone: 'edit' | 'read' | 'command' }) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, 6)
  return (
    <div className={`files files--${tone}`}>
      <span className="files__label">{label} <span className="faint num">{items.length}</span></span>
      <ul>{shown.map((f) => <li key={f} className="mono truncate" title={f}>{shortTarget(f, 70)}</li>)}</ul>
      {items.length > 6 && <button type="button" className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Fewer' : `${items.length - 6} more`}</button>}
    </div>
  )
}

function EvidenceDetail({ evidence }: { evidence: Evidence }) {
  const { store } = useApp()
  const [log, setLog] = useState<string | null>(null)
  const ok = passed(evidence)
  return (
    <aside className="inspector">
      <Head kind={`Check · ${PHASE[evidence.phase]}`} title={evidence.label} basis="observed" tone={ok ? 'ok' : 'bad'} />
      <dl className="hx-kv">
        <dt>Command</dt><dd className="mono">{evidence.argv.join(' ')}</dd>
        <dt>Folder</dt><dd className="mono">{evidence.cwd}</dd>
        <dt>Commit</dt><dd className="mono">{shortSha(evidence.commitSha)}</dd>
        <dt>Result</dt><dd>{evidence.spawnError ? `Did not run: ${evidence.spawnError}` : evidence.timedOut ? 'Timed out' : `Exit code ${evidence.exitCode}`}{evidence.treeMutated ? ' · changed tracked files (not trusted)' : ''}</dd>
        <dt>Time</dt><dd className="num">{duration(evidence.durationMs)}{evidence.required ? ' · required' : ' · optional'}</dd>
      </dl>
      <section className="inspector__block">
        <h4>Output</h4>
        <pre className="hx-log" style={{ maxHeight: 260 }}>{log ?? (evidence.outputTail || '(no output)')}</pre>
        <div className="spread">
          <span className="faint mono" style={{ fontSize: 11 }}>sha256 {evidence.outputSha256.slice(0, 12)}… · {evidence.outputBytes} bytes</span>
          {log === null && evidence.outputBytes > 0 && <Button size="sm" onClick={() => void store.transport.evidenceLog(evidence.id).then(setLog, (e: Error) => setLog(`Log unavailable: ${e.message}`))}>Full log</Button>}
        </div>
      </section>
      <p className="faint" style={{ fontSize: 11.5 }}>Hydra ran this command itself on the exact commit shown; the agents cannot change this result.</p>
    </aside>
  )
}

function StateDetail({ segment, task }: { segment: Segment; task: Task }) {
  const explain: Record<Segment['kind'], string> = {
    gate: segment.ref.type === 'gate' && segment.ref.reason === 'plan_approval'
      ? 'The agents have only read your code. Nothing is edited until you approve the plan and the exact check commands Hydra will run.'
      : 'Hydra has verified the result in an isolated copy. Your branch changes only if you accept this exact commit.',
    wait: 'This stage needs an agent, and none has started yet. Hydra runs at most a fixed number of agents at once across all tasks; the others wait for a free slot. Deduced from the stage record and the running agents.',
    checking: 'Hydra is running your check commands itself. Each result appears when its command finishes. Deduced from the stage record: the engine reports a check only once it is done.',
    apply: 'Hydra fast-forwards your branch to exactly the commit you accepted. This step cannot be canceled midway.',
    run: '', check: ''
  }
  return (
    <aside className="inspector">
      <Head kind={segment.kind === 'gate' ? 'Your decision' : segment.kind === 'apply' ? 'Apply' : 'In between'} title={segment.label} basis={segment.basis} tone={toneOf(segment.status)} />
      <p className="muted">{explain[segment.kind]}</p>
      {segment.kind === 'gate' && task.status === 'waiting_input' && <p className="faint" style={{ marginTop: 8 }}>Use the decision bar above the trace.</p>}
    </aside>
  )
}

function LaneDetail({ trace, task, runs, lane, onSelect }: { trace: Trace; task: Task; runs: AgentRunInfo[]; lane: Trace['lanes'][number]['id']; onSelect: (s: Selection) => void }) {
  const info = trace.lanes.find((l) => l.id === lane)
  if (!info) return <Gone />
  const mine = trace.segments.filter((s) => s.lane === lane)
  const roleRuns = runs.filter((r) => ({ planner: 'planner', implementer: 'implementer', reviewer: 'reviewer' } as const)[r.role] === lane)
  const spent = roleRuns.reduce((n, r) => n + r.usage.costUsd, 0)
  return (
    <aside className="inspector">
      <Head kind={lane === 'you' ? 'You' : lane === 'hydra' ? 'Hydra' : 'Agent'} title={`${info.title}${info.actor !== info.title ? ` · ${info.actor}` : ''}`} />
      <p className="muted">{info.duty}.</p>
      {task.selection && lane !== 'you' && lane !== 'hydra' && (
        <p className="muted" style={{ marginTop: 8 }}>{task.selection.basis === 'suggested' ? 'Hydra suggested these agents' : 'You chose these agents'}: {task.selection.reason}</p>
      )}
      {roleRuns.length > 0 && <p className="faint num" style={{ marginTop: 8 }}>{roleRuns.length} run{roleRuns.length === 1 ? '' : 's'} · {money(spent)}</p>}
      <ul className="lane-items">
        {mine.map((s) => (
          <li key={s.id}><button type="button" className="link-btn" onClick={() => onSelect({ kind: 'segment', id: s.id })}>{s.label}</button> <span className="faint num">{duration(Math.max(0, (s.end ?? trace.now) - s.start))}</span></li>
        ))}
      </ul>
    </aside>
  )
}

function BatonDetail({ baton, task, evidence, trace }: { baton: Baton; task: Task; evidence: Evidence[]; trace: Trace }) {
  const stage = baton.ref?.type === 'stage' ? task.stages.find((s) => s.stage === (baton.ref as { stage: string }).stage && s.attempt === (baton.ref as { attempt: number }).attempt) : null
  const latest = (s: Task['stages'][number] | null | undefined) => s && task.stages.filter((x) => x.stage === s.stage).at(-1) === s
  let body: React.ReactNode = null
  switch (baton.kind) {
    case 'request': body = <div className="prose">{task.prompt}</div>; break
    case 'answer': body = task.answer ? <Markdown text={task.answer} /> : <p className="faint">The answer is shown in the conversation.</p>; break
    case 'plan': body = task.plan && latest(stage) ? (
      <div className="stack" style={{ gap: 10 }}>
        <p>{task.plan.summary}</p>
        <ol className="list-plain">{task.plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        {task.plan.risks.length > 0 && <><h4>Risks</h4><ul className="list-plain muted">{task.plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></>}
      </div>) : <p className="muted">{baton.label}</p>; break
    case 'review':
    case 'repair':
      if (stage?.stage === 'review' && latest(stage) && task.review) {
        body = (
          <div className="stack" style={{ gap: 10 }}>
            <p>{task.review.summary}</p>
            {task.review.findings.map((f, i) => <div key={i} className="finding"><Badge tone={f.severity === 'blocker' ? 'bad' : f.severity === 'major' ? 'warn' : 'neutral'}>{f.severity}</Badge><div>{f.file && <code>{f.file}</code>} {f.issue}{f.suggestion && <div className="faint">→ {f.suggestion}</div>}</div></div>)}
          </div>)
      } else if (stage?.stage === 'verify') {
        const from = Date.parse(stage.startedAt); const to = stage.endedAt ? Date.parse(stage.endedAt) : trace.now
        const mine = evidence.filter((e) => e.phase === 'verify' && Date.parse(e.startedAt) >= from - 1000 && Date.parse(e.startedAt) <= to)
        body = <EvidenceList items={mine} />
      } else body = <p className="muted">{baton.label}. Earlier rounds keep only this summary; the full review shown is always the latest.</p>
      if (baton.kind === 'repair') body = <>{body}<p className="faint" style={{ marginTop: 10 }}>Hydra sent this back to the implementer for a repair round (at most {task.budget.maxFixRounds} automatic rounds).</p></>
      break
    case 'checks': {
      const from = stage ? Date.parse(stage.startedAt) : 0
      body = <EvidenceList items={evidence.filter((e) => e.phase === 'verify' && Date.parse(e.startedAt) >= from - 1000)} />
      break
    }
    // Only the latest round's comparison is kept on the task; an earlier round shows its summary.
    case 'demo': body = task.demo && latest(stage) ? (
      <div className="stack" style={{ gap: 6 }}>
        {task.demo.deltas.map((d) => <div key={d.checkId} className="spread"><span className="mono truncate">{d.label}</span><span className="row"><Badge tone={d.before === 'pass' ? 'ok' : 'bad'}>{d.before}</Badge>→<Badge tone={d.after === 'pass' ? 'ok' : 'bad'}>{d.after}</Badge></span></div>)}
        <p className="faint">Hydra ran the same checks on your original commit and on the result.</p>
      </div>) : <p className="muted">{baton.label}. The full comparison is kept only for the latest round.</p>; break
    case 'changes': body = <p className="muted">{baton.label}. The diff is in the Changes tab{task.workspace ? ` (branch ${task.workspace.branch})` : ''}.</p>; break
    case 'decision': body = <p className="muted">{task.feedback.find((f) => `feedback-${f.at}` === baton.id)?.text ?? baton.label}</p>; break
  }
  return (
    <aside className="inspector">
      <Head kind="Artifact" title={baton.label} basis={baton.basis} />
      <div className="inspector__block">{body}</div>
    </aside>
  )
}

function EvidenceList({ items }: { items: Evidence[] }) {
  if (!items.length) return <p className="faint">No check results in this round.</p>
  return <ul className="evidence-list">{items.map((e) => <li key={e.id} className="spread"><span className="mono truncate">{e.label}</span><Badge tone={passed(e) ? 'ok' : 'bad'}>{passed(e) ? 'passed' : e.spawnError ? 'not run' : `exit ${e.exitCode}`}</Badge></li>)}</ul>
}
