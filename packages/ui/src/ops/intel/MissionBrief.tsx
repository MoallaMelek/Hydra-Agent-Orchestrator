import { Button } from '../../design/components'
import type { IntelGraph, IntelNode } from './graph'
import { fmtDuration, fmtOffset, ROLE_NAME } from './text'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * The inspector when nothing is selected: a briefing computed from this mission's records
 * (at the replay cursor when replaying). Every line links to the record it summarises.
 */
export function MissionBrief({ graph: g, onSelect, onDeliver, at }: { graph: IntelGraph; onSelect: (id: string) => void; onDeliver?: () => void; at?: string }) {
  const t = g.task
  const agents = g.nodes.filter((n) => n.kind === 'agent').sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const handoffs = g.edges.filter((e) => e.kind === 'handoff').sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const decision = g.byId.get('decision')
  const files = g.nodes.filter((n) => n.kind === 'file' && (n.file!.edits > 0 || n.file!.findings > 0 || n.file!.diff)).sort((a, b) => b.weight - a.weight).slice(0, 5)
  const quiet = g.nodes.filter((n) => n.kind === 'file').length - g.nodes.filter((n) => n.kind === 'file' && (n.file!.edits > 0 || n.file!.findings > 0 || n.file!.diff)).length
  const revisions = g.nodes.filter((n) => n.kind === 'revision')
  const latest = [...revisions].reverse().find((r) => g.edges.some((e) => e.kind === 'tested' && e.to === r.id))
  const latestChecks = latest ? g.edges.filter((e) => e.kind === 'tested' && e.to === latest.id).map((e) => g.byId.get(e.from)!).filter(Boolean) : []
  const failing = latestChecks.filter((c) => c.status === 'failed')
  const openFindings = g.nodes.filter((n) => n.kind === 'finding' && n.status === 'blocked')
  const link = (n: IntelNode, text?: string) => <button className="linkish" onClick={() => onSelect(n.id)}>{text ?? n.label}</button>
  const role = (id: string) => g.byId.get(id)

  return <div className="insp brief">
    <header className="insp-head">
      <p className="eyebrow">Mission briefing{at ? ` · as of ${at}` : ''}</p>
      <h2 className="insp-title">{t.title}</h2>
    </header>

    {decision && (decision.status === 'waiting' || decision.status === 'blocked') && <section className="brief-block brief-block--you">
      <h3>Needs you</h3>
      {decision.status === 'blocked'
        ? <><p>Hydra will refuse acceptance until these are resolved:</p><ul className="insp-unresolved">{decision.decision!.unresolved.map((u) => <li key={u}>{u}</li>)}</ul></>
        : <p>{t.waitReason === 'plan_approval' ? 'The plan is ready. Nothing has been written yet.' : 'Checks and review cover the current revision. Your decision delivers it or sends it back.'}</p>}
      {onDeliver && <Button size="sm" variant="primary" onClick={onDeliver}>Go to the decision</Button>}
    </section>}

    {agents.length > 0 && <section className="brief-block">
      <h3>Agents <span className="mono faint">{agents.length}</span></h3>
      <ul className="brief-agents">{agents.map((a) => {
        const f = a.agent!
        return <li key={a.id}>
          <button className={`brief-agent a-${f.role}`} onClick={() => onSelect(a.id)}>
            <span className="brief-agent__mark" aria-hidden>{f.role[0]!.toUpperCase()}</span>
            <span className="brief-agent__name"><b>{ROLE_NAME[f.role]}</b> · {a.label.split(' · ')[1]}{a.status === 'running' && <em> · running</em>}</span>
            <span className="brief-agent__facts mono">{plural(f.runs.length, 'run')} · {plural(f.toolCalls, 'call')} · {fmtDuration(f.activeMs)}{f.revisions ? ` · ${plural(f.revisions, 'revision')}` : ''}{f.findings ? ` · ${plural(f.findings, 'finding')}` : ''}</span>
          </button>
        </li>
      })}</ul>
    </section>}

    {handoffs.length > 0 && <section className="brief-block">
      <h3>Handoffs <span className="mono faint">{handoffs.length}</span></h3>
      <ol className="brief-relay">{handoffs.map((e) => {
        const a = role(e.from), b = role(e.to)
        if (!a || !b) return null
        return <li key={e.id}>
          <span className={`dot a-${a.actor}`} aria-hidden />{ROLE_NAME[a.actor ?? '']}<span className="faint"> → </span><span className={`dot a-${b.actor}`} aria-hidden />{link(b, ROLE_NAME[b.actor ?? ''] ?? b.label)}
          <span className="faint">: {e.label}{e.at !== null ? ` · ${fmtOffset(e.at, g.start)}` : ''}</span>
        </li>
      })}</ol>
      <p className="insp-note">Agents don't talk to each other. Hydra passes the artifact named on each handoff to the next run.</p>
    </section>}

    {(files.length > 0 || quiet > 0) && <section className="brief-block">
      <h3>Where the work landed</h3>
      <ul className="brief-files">{files.map((f) => <li key={f.id}>{link(f, f.file!.path)}<span className="faint mono"> {[f.file!.edits ? plural(f.file!.edits, 'edit') : '', f.file!.diff ? `+${f.file!.diff.additions} −${f.file!.diff.deletions}` : '', f.file!.findings ? plural(f.file!.findings, 'finding') : ''].filter(Boolean).join(' · ')}</span></li>)}</ul>
      {quiet > 0 && <p className="insp-note">{plural(quiet, 'more file')} were only read or planned; they stay faint on the map.</p>}
    </section>}

    {(latestChecks.length > 0 || openFindings.length > 0) && <section className="brief-block">
      <h3>Proof</h3>
      {latest && <p>On {link(latest, latest.revision!.short)}: {latestChecks.length - failing.length} of {latestChecks.length} checks passed.</p>}
      {failing.length > 0 && <ul className="brief-files">{failing.map((c) => <li key={c.id} className="is-stop">{link(c, `${c.label} failed`)}</li>)}</ul>}
      {openFindings.length > 0 && <p className="is-stop">{plural(openFindings.length, 'blocking finding')} in the latest review: {openFindings.slice(0, 3).map((f, i) => <span key={f.id}>{i ? ', ' : ''}{link(f, f.label.length > 40 ? f.label.slice(0, 38) + '…' : f.label)}</span>)}</p>}
    </section>}

    {g.gaps.length > 0 && <section className="brief-block"><h3>Not in this data</h3>{g.gaps.map((x) => <p key={x} className="insp-note">{x}</p>)}</section>}

    <details className="brief-legend">
      <summary>How to read the map</summary>
      <ul>
        <li><span className="glyph g-agent" aria-hidden /><span>Rings outside the clock are agents: a role on a provider. Their runs sit inside, marked with the same initial.</span></li>
        <li><span className="glyph g-stage" aria-hidden /><span>Stages run clockwise from the top, in recorded order.</span></li>
        <li><span className="glyph g-handoff" aria-hidden /><span>Arrows between runs are handoffs, labelled with what Hydra passed on.</span></li>
        <li><span className="glyph g-revision" aria-hidden /><span>Diamonds are the revisions Hydra committed, oldest on the left. The badge above each counts its checks.</span></li>
        <li><span className="glyph g-file" aria-hidden /><span>Squares are files. Solid: in the final change. Faint: only read.</span></li>
        <li><span className="glyph g-decision" aria-hidden /><span>The crosshair is your decision. Red always means something stops.</span></li>
        <li><span className="glyph g-lines" aria-hidden /><span>Solid lines were recorded by the engine; dashed ones are derived by a stated rule; dotted ones are only planned.</span></li>
      </ul>
      <p className="insp-note">Click anything to see its record. Keyboard: Tab to the map, arrows move, Enter inspects, F focuses, Esc steps back.</p>
    </details>
  </div>
}
