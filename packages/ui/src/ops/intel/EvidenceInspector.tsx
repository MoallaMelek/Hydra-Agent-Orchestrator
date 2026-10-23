import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../../app/context'
import { Button } from '../../design/components'
import { passedEvidence, STAGE_LABEL, type IntelGraph, type IntelNode } from './graph'
import { labelOf } from './renderer'
import { MissionBrief } from './MissionBrief'
import { BASIS_HELP, BASIS_TEXT, fmtDuration, fmtOffset, KIND_NAME, neighbours, providerName, ROLE_NAME, statusWord } from './text'

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return <dl className="insp-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}

function DiffBlock({ patch }: { patch: string }) {
  const lines = patch.split('\n')
  return <pre className="insp-diff" tabIndex={0} aria-label="Diff">{lines.slice(0, 400).map((line, i) => {
    const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : ''
    return <span key={i} className={cls}>{line + '\n'}</span>
  })}{lines.length > 400 && <span className="hunk">{`… ${lines.length - 400} more lines in Records → Changes\n`}</span>}</pre>
}

/** Full output of one check, fetched on request (the store only keeps the tail). */
function FullLog({ evidenceId }: { evidenceId: string }) {
  const { store } = useApp()
  const [state, setState] = useState<{ text?: string; error?: string; busy?: boolean }>({})
  useEffect(() => setState({}), [evidenceId])
  if (state.text !== undefined) return <pre className="insp-log" tabIndex={0}>{state.text || '(no output)'}</pre>
  return <div className="row">
    <Button size="sm" busy={state.busy} onClick={() => { setState({ busy: true }); store.transport.evidenceLog(evidenceId).then((text) => setState({ text })).catch((e: Error) => setState({ error: e.message })) }}>Load full output</Button>
    {state.error && <span role="alert" className="insp-warn">{state.error}</span>}
  </div>
}

export interface InspectorProps {
  graph: IntelGraph
  node: IntelNode | null
  focused: string | null
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onDeliver?: () => void
  /** Replay position, when replaying. */
  at?: string
}

/** One record at a time: what it is, how it is known, the evidence, and what it connects to. */
export function EvidenceInspector({ graph: g, node: n, focused, onSelect, onFocus, onDeliver, at }: InspectorProps) {
  if (!n) return <MissionBrief graph={g} onSelect={onSelect} onDeliver={onDeliver} at={at} />
  const word = statusWord(n)
  const { ins, outs } = neighbours(g, n.id)
  const link = (node: IntelNode) => <button className="linkish" onClick={() => onSelect(node.id)}>{node.kind === 'file' ? node.file!.path : labelOf(node)}</button>
  return <div className="insp" key={n.id}>
    <header className="insp-head">
      <div className="spread">
        <p className="eyebrow">{KIND_NAME[n.kind]}{n.actor ? ` · ${ROLE_NAME[n.actor]}` : ''}</p>
        {n.kind !== 'mission' && <Button size="sm" variant="ghost" aria-pressed={focused === n.id} onClick={() => onFocus(n.id)}>{focused === n.id ? 'Leave focus' : 'Focus'} <kbd>{focused === n.id ? 'Esc' : 'F'}</kbd></Button>}
      </div>
      <h2 className="insp-title">{n.kind === 'file' ? n.file!.path : n.label}</h2>
      <div className="insp-tags">
        {word && <span className={`tag s-${n.status}`}>{word}</span>}
        <span className={`tag b-${n.basis}`} title={BASIS_HELP[n.basis]}>{BASIS_TEXT[n.basis]}</span>
        {n.at !== null && <span className="tag">{fmtOffset(n.at, g.start)}</span>}
        {n.end !== null && n.at !== null && <span className="tag">{fmtDuration(n.end - n.at)}</span>}
      </div>
    </header>
    <div className="insp-body">
      {n.kind === 'agent' && (() => {
        const a = n.agent!
        const runs = a.runs.map((id) => g.byId.get(id)).filter((r): r is IntelNode => Boolean(r))
        return <>
          <Facts rows={[['Role', ROLE_NAME[a.role] ?? a.role], ['Provider', providerName(a.provider)], ['Runs', String(runs.length)], ['Reported calls', `${a.toolCalls} · ${a.edits} edit${a.edits === 1 ? '' : 's'}`], ['Produced', `${a.revisions} revision${a.revisions === 1 ? '' : 's'} · ${a.findings} finding${a.findings === 1 ? '' : 's'}`], ['Active time', fmtDuration(a.activeMs)], ['Reported usage', `${a.tokens.toLocaleString()} tokens${a.costUsd ? ` · $${a.costUsd.toFixed(3)}` : ''}`]]} />
          <h3>Runs</h3>
          <ol className="insp-list">{runs.map((r) => <li key={r.id}>{link(r)} <span className="faint mono">{r.at !== null ? fmtOffset(r.at, g.start) : ''}{r.at !== null && r.end !== null ? ` · ${fmtDuration(r.end - r.at)}` : r.status === 'running' ? ' · running' : ''}</span></li>)}</ol>
          <p className="insp-note">An agent here is a role played by a provider CLI. Each run is a separate process; the engine passes artifacts between runs.</p>
        </>
      })()}
      {n.kind === 'run' && (() => {
        const got = g.edges.filter((e) => e.kind === 'handoff' && e.to === n.id), gave = g.edges.filter((e) => e.kind === 'handoff' && e.from === n.id)
        return (got.length > 0 || gave.length > 0) && <>
          <h3>Handoffs</h3>
          <ul className="insp-rel">
            {got.map((e) => <li key={e.id}><span className="faint">received </span>{e.label}<span className="faint"> from </span>{link(g.byId.get(e.from)!)}</li>)}
            {gave.map((e) => <li key={e.id}><span className="faint">handed </span>{e.label}<span className="faint"> to </span>{link(g.byId.get(e.to)!)}</li>)}
          </ul>
        </>
      })()}
      {n.kind === 'run' && (() => {
        const f = n.runFacts!
        return <>
          <Facts rows={[['Provider', providerName(f.run.provider)], ['Stage', `${STAGE_LABEL[f.run.stage]}${n.attempt && n.attempt > 1 ? ` · attempt ${n.attempt}` : ''}`], ['Reported calls', `${f.reads} read · ${f.edits} edit · ${f.searches} search · ${f.commands.length} command`], ['Reported usage', `${(f.run.usage.inputTokens + f.run.usage.outputTokens).toLocaleString()} tokens${f.run.usage.costUsd ? ` · $${f.run.usage.costUsd.toFixed(3)}` : ' · unpriced'}`]]} />
          {f.run.error && <p className="insp-warn">{f.run.error}</p>}
          <h3>Reported tool calls</h3>
          {f.activity.length ? <ol className="insp-ops">{f.activity.map((a, i) => <li key={i}><span className={`op op-${a.kind}`}>{a.tool}</span> <code>{a.target}</code> <span className="faint">{fmtOffset(Date.parse(a.at), g.start)}</span></li>)}</ol> : <p className="faint">No tool calls were reported for this run.</p>}
          <p className="insp-note">Tool calls are what the provider CLI reported: names and targets only. Hydra does not record model reasoning.</p>
        </>
      })()}
      {n.kind === 'file' && (() => {
        const f = n.file!
        return <>
          <Facts rows={[['Planned', f.planned ? 'Named in the plan' : 'Not named in the plan'], ['Reported', `${f.reads} read · ${f.edits} edit`], ['Touched by', f.touchedBy.map((r) => ROLE_NAME[r]).join(', ') || 'No agent reported touching it'], ['In final change', f.diff ? `${f.diff.status} · +${f.diff.additions} −${f.diff.deletions}` : 'Not in the received diff'], ['Findings', String(f.findings)]]} />
          {f.diff?.patch && <><h3>Change against your branch</h3><DiffBlock patch={f.diff.patch} /></>}
        </>
      })()}
      {n.kind === 'check' && (() => {
        const e = n.evidence!
        return <>
          <Facts rows={[['Command', <code key="c">{e.argv.join(' ')}</code>], ['Revision', <code key="r">{e.commitSha.slice(0, 7)}</code>], ['Exit', e.spawnError ? `Could not start: ${e.spawnError}` : e.timedOut ? 'Timed out' : String(e.exitCode)], ['Duration', fmtDuration(e.durationMs)], ['Output', `${e.outputBytes.toLocaleString()} bytes${e.outputTruncated ? ' · truncated' : ''} · sha256 ${e.outputSha256.slice(0, 12)}`]]} />
          {e.treeMutated && <p className="insp-warn">The check modified tracked files, so Hydra treats this result as untrustworthy.</p>}
          <h3>{passedEvidence(e) ? 'Output (tail)' : 'Why it failed (output tail)'}</h3>
          <pre className="insp-log" tabIndex={0}>{e.outputTail.split('\n').slice(-40).join('\n') || '(no output)'}</pre>
          <FullLog evidenceId={e.id} />
        </>
      })()}
      {n.kind === 'finding' && (() => {
        const f = n.finding!
        return <><p className="insp-lead">{f.issue}</p><Facts rows={[['Suggestion', f.suggestion || '—'], ['File', f.file ?? 'No file named'], ['Review', `Review ${f.review + 1}${f.reviewedSha ? ` of ${f.reviewedSha.slice(0, 7)}` : ''}`]]} /></>
      })()}
      {n.kind === 'revision' && (() => {
        const r = n.revision!
        const checks = g.nodes.filter((x) => x.kind === 'check' && x.evidence!.commitSha.startsWith(r.short))
        return <>
          <Facts rows={[['Commit', <code key="c">{r.sha}</code>], ['Role', n.detail], ['Checks on it', checks.length ? `${checks.filter((c) => c.status === 'ok').length} passed · ${checks.filter((c) => c.status === 'failed').length} failed` : 'None ran on this revision']]} />
          <p className="insp-note">Revisions are listed in the order they appeared in records. Git ancestry is not part of this data, so the chain between them is derived.</p>
        </>
      })()}
      {n.kind === 'stage' && <Facts rows={[['Note', n.detail || '—'], ['Recorded status', n.stageRecord!.status]]} />}
      {n.kind === 'decision' && (() => {
        const d = n.decision!
        if (d.acceptance) return <Facts rows={[['Accepted revision', <code key="r">{d.acceptance.revision.slice(0, 7)}</code>], ['By', `${d.acceptance.actor} · ${d.acceptance.source}`], ['Evidence bound', `${d.acceptance.evidenceIds.length} check results`], ['Receipt', <code key="d">{d.acceptance.decisionId}</code>]]} />
        if (d.waiting === 'final_approval') return <>
          <p className="insp-lead">{d.allowed ? 'Checks and review cover this exact revision. Accepting fast-forwards your branch to it.' : 'Hydra will refuse acceptance until these are resolved:'}</p>
          {!d.allowed && <ul className="insp-unresolved">{d.unresolved.map((u) => <li key={u}>{u}</li>)}</ul>}
          {onDeliver && <Button variant="primary" onClick={onDeliver}>Go to the decision</Button>}
        </>
        if (d.waiting === 'plan_approval') {
          const plan = g.task.plan
          return <>
            {plan && <><p className="insp-lead">{plan.summary}</p><h3>Steps</h3><ol className="insp-list">{plan.steps.map((s) => <li key={s}>{s}</li>)}</ol>{plan.risks.length > 0 && <><h3>Risks</h3><ul className="insp-list">{plan.risks.map((s) => <li key={s}>{s}</li>)}</ul></>}</>}
            {onDeliver && <Button variant="primary" onClick={onDeliver}>Go to the decision</Button>}
          </>
        }
        return <p className="faint">{g.task.outcome ? `Outcome: ${g.task.outcome.replace('_', ' ')}.` : 'No decision has been requested yet.'}</p>
      })()}
      {n.kind === 'mission' && <p className="insp-prompt">{g.task.prompt}</p>}
      {(ins.length > 0 || outs.length > 0) && <>
        <h3>Connections</h3>
        <ul className="insp-rel">
          {ins.map(({ node, verb }) => <li key={`i${node.id}`}><span className="faint">{verb} </span>{link(node)}</li>)}
          {outs.map(({ node, verb }) => <li key={`o${node.id}`}><span className="faint">{verb} </span>{link(node)}</li>)}
        </ul>
      </>}
    </div>
  </div>
}
