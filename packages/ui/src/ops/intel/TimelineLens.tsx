import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IntelGraph, IntelNode } from './graph'
import { fileTarget } from './graph'
import { labelOf } from './renderer'
import { fmtDuration, fmtOffset, KIND_NAME, ROLE_NAME, statusWord } from './text'

const GUTTER = 132
const RIGHT = 24
const ROLES = ['planner', 'implementer', 'reviewer'] as const

/**
 * Timeline lens (from concept B): recorded time runs left to right through four planes
 * (You, Agents, Code, Proof). Every revision is a gate through all planes. Same records and
 * selection as the map; only the arrangement differs. Agents take turns, so runs never overlap
 * unless the records say they did.
 */
export function TimelineLens({ graph: g, full, selected, onSelect }: { graph: IntelGraph; full: IntelGraph; selected: string | null; onSelect: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el); setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const span = Math.max(1, full.end - full.start)
  const x = (t: number) => GUTTER + ((t - full.start) / span) * (width - GUTTER - RIGHT)
  const revisions = g.nodes.filter((n) => n.kind === 'revision')
  const runs = g.nodes.filter((n) => n.kind === 'run').sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const checks = g.nodes.filter((n) => n.kind === 'check')
  const findings = g.nodes.filter((n) => n.kind === 'finding')
  const files = g.nodes.filter((n) => n.kind === 'file' && (n.file!.edits > 0 || n.file!.diff)).sort((a, b) => b.weight - a.weight)
  const shownFiles = files.slice(0, 7)
  const commands = [...new Set(checks.map((c) => c.label))]
  const decision = g.byId.get('decision')
  const mission = g.byId.get('mission')!
  const sel = (id: string) => ({ onClick: () => onSelect(id), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id) } }, tabIndex: 0, role: 'button', className: id === selected ? 'is-selected' : undefined, 'aria-pressed': id === selected })
  const end = (n: IntelNode) => n.end ?? g.end

  const plane = (name: string, sub: string, height: number, body: ReactNode, top = false) => (
    <div className="tl-plane">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${name}: ${sub}`}>
        <text x={14} y={20} className="tl-name">{name}</text>
        <text x={14} y={34} className="tl-sub">{sub}</text>
        {revisions.map((r) => r.at !== null && <g key={r.id} className={`tl-gate ${r.revision!.role}`}>
          <line x1={x(r.at)} x2={x(r.at)} y1={top ? 26 : 0} y2={height} />
          {top && <g {...sel(r.id)} aria-label={`Revision ${r.revision!.short}`}><rect x={x(r.at) - 30} y={6} width={60} height={18} rx={2} /><text x={x(r.at)} y={19} textAnchor="middle">{r.revision!.short}</text></g>}
        </g>)}
        {body}
      </svg>
    </div>
  )
  const lane = (y: number, label: string) => <g className="tl-lane"><text x={GUTTER - 12} y={y + 4} textAnchor="end">{label}</text><line x1={GUTTER} x2={width - RIGHT} y1={y} y2={y} /></g>

  if (width < 560) {
    return <div ref={ref} className="tl tl--narrow">
      <p className="faint">The timeline needs a wider window. Recorded runs, in order:</p>
      <ol className="tl-rows">{runs.map((r) => <li key={r.id}><button className="net__item" onClick={() => onSelect(r.id)}><span className={`glyph g-run a-${r.actor}`} aria-hidden />{r.label}<span className="faint mono">{r.at !== null ? fmtOffset(r.at, full.start) : ''}{r.at !== null && r.end !== null ? ` · ${fmtDuration(r.end - r.at)}` : ''}</span></button></li>)}</ol>
    </div>
  }

  const cursorX = g.end < full.end ? x(g.end) : null
  return <div ref={ref} className="tl" aria-label="Timeline of recorded work">
    {plane('You', 'request · decision', 70, <>
      {lane(50, 'decisions')}
      {mission.at !== null && <g {...sel('mission')} aria-label="Your request"><circle cx={x(mission.at)} cy={50} r={5} className="m-you" /></g>}
      {decision && decision.at !== null && <g {...sel('decision')} aria-label={`${decision.label}: ${statusWord(decision)}`}>
        <circle cx={x(decision.at)} cy={50} r={7} className={decision.status === 'blocked' ? 'm-stop-ring' : 'm-you-ring'} />
        <line x1={x(decision.at) - 11} x2={x(decision.at) + 11} y1={50} y2={50} className={decision.status === 'blocked' ? 'm-stop-ring' : 'm-you-ring'} />
        <text x={x(decision.at) > width - 200 ? x(decision.at) - 14 : x(decision.at) + 14} y={x(decision.at) > width - 200 ? 34 : 46} textAnchor={x(decision.at) > width - 200 ? 'end' : 'start'} className="tl-mark-label">{decision.label}{decision.status === 'blocked' ? ' · blocked' : decision.status === 'waiting' ? ' · waiting' : ''}</text>
      </g>}
    </>, true)}
    {plane('Agents', 'runs in recorded order', 46 + ROLES.length * 30, <>
      {ROLES.map((r, i) => lane(56 + i * 30, ROLE_NAME[r]!))}
      {runs.map((r, i) => {
        if (r.at === null) return null
        const y = 56 + Math.max(0, ROLES.indexOf(r.actor as typeof ROLES[number])) * 30
        const next = runs[i + 1]
        const w = Math.max(3, x(end(r)) - x(r.at))
        return <g key={r.id}>
          {next && next.at !== null && r.end !== null && <path className="tl-handoff" d={`M${x(r.end)},${y} C${x(r.end) + 14},${y} ${x(next.at) - 14},${56 + Math.max(0, ROLES.indexOf(next.actor as typeof ROLES[number])) * 30} ${x(next.at)},${56 + Math.max(0, ROLES.indexOf(next.actor as typeof ROLES[number])) * 30}`} />}
          <g {...sel(r.id)} aria-label={`${r.label}, ${statusWord(r)}`}>
            <rect x={x(r.at)} y={y - 6} width={w} height={12} rx={2} className={`tl-run a-${r.actor} s-${r.status}`} />
            {w > 70 && <text x={x(r.at) + 6} y={y + 4} className="tl-run-label">{r.label.split(' · ')[1] ?? r.label}</text>}
          </g>
        </g>
      })}
    </>)}
    {plane('Code', shownFiles.length < files.length ? `edits · top ${shownFiles.length} of ${files.length} files` : 'edits by file', 46 + Math.max(1, shownFiles.length) * 24, <>
      {shownFiles.length === 0 && <text x={GUTTER} y={56} className="tl-sub">No file edits were reported.</text>}
      {shownFiles.map((f, i) => {
        const y = 52 + i * 24
        const path = f.file!.path
        const edits = runs.flatMap((r) => r.runFacts!.activity.filter((a) => a.kind === 'edit' && fileTarget(a) === path).map((a) => ({ t: Date.parse(a.at), actor: r.actor })))
        return <g key={f.id}>
          {lane(y, path.length > 16 ? '…' + path.slice(-15) : path)}
          {edits.map((e, j) => <rect key={j} x={x(e.t) - 1.5} y={y - 7} width={3} height={14} className={`tl-edit a-${e.actor}`} />)}
          <g {...sel(f.id)} aria-label={`File ${path}`}><rect x={width - RIGHT - 2} y={y - 5} width={10} height={10} className={f.file!.diff ? 'tl-file in-diff' : 'tl-file'} /></g>
        </g>
      })}
    </>)}
    {plane('Proof', 'checks Hydra ran · review findings', 46 + (commands.length + (findings.length ? 1 : 0)) * 26 + (commands.length ? 0 : 20), <>
      {commands.length === 0 && <text x={GUTTER} y={56} className="tl-sub">No checks ran.</text>}
      {commands.map((cmd, i) => {
        const y = 54 + i * 26
        return <g key={cmd}>{lane(y, cmd.length > 16 ? cmd.slice(0, 15) + '…' : cmd)}
          {checks.filter((c) => c.label === cmd && c.at !== null).map((c) => <g key={c.id} {...sel(c.id)} aria-label={`${c.label} ${statusWord(c)} at ${c.evidence!.commitSha.slice(0, 7)}`}>
            <rect x={x(c.at!)} y={y - 3} width={Math.max(2, x(end(c)) - x(c.at!))} height={6} className="tl-check-bar" />
            <polygon points={hex(x(end(c)), y, 6)} className={`tl-check s-${c.status}`} />
          </g>)}
        </g>
      })}
      {findings.length > 0 && <g>{lane(54 + commands.length * 26, 'findings')}
        {findings.map((f) => f.at !== null && <g key={f.id} {...sel(f.id)} aria-label={`${statusWord(f)} finding: ${f.label}`}>
          <polygon points={tri(x(f.at), 54 + commands.length * 26, 7)} className={`tl-finding sev-${f.finding!.severity}`} />
        </g>)}
      </g>}
    </>)}
    <div className="tl-axis" aria-hidden><span style={{ left: GUTTER }}>{fmtOffset(full.start, full.start)}</span><span style={{ right: RIGHT }}>{fmtOffset(full.end, full.start)} · {fmtDuration(span)} recorded</span></div>
    {cursorX !== null && <div className="tl-cursor" style={{ left: cursorX }} aria-hidden />}
    {selected && g.byId.get(selected) && <p className="sr-only" aria-live="polite">{KIND_NAME[g.byId.get(selected)!.kind]} selected: {labelOf(g.byId.get(selected)!)}</p>}
  </div>
}

const hex = (cx: number, cy: number, r: number) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}` }).join(' ')
const tri = (cx: number, cy: number, r: number) => `${cx},${cy - r} ${cx + r * 0.9},${cy + r * 0.6} ${cx - r * 0.9},${cy + r * 0.6}`
