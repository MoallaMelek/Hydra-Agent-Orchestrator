import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, FlaskConical, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import type { CheckDraft, CheckSpec } from '@hydra/protocol'
import { Badge, Button, Callout, Panel } from '../design/components'
import { useApp } from '../app/context'

interface ChecksInfo { source: 'yours' | 'file' | 'detected'; checks: CheckSpec[]; detected: CheckSpec[]; problem: string | null }
interface TestResult { passed: boolean; exitCode: number | null; timedOut: boolean; spawnError: string | null; durationMs: number; outputTail: string; warnings: string[]; commit: string }
interface Row { draft: CheckDraft; command: string; result?: TestResult; testing?: boolean }

const SOURCE = { yours: 'your list (kept in Hydra)', file: '.hydra/checks.json from your project', detected: 'automatic detection' }

/** Splits a command line into arguments, honouring "double" and 'single' quotes. No shell is involved. */
export function splitCommand(line: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const ch of line.trim()) {
    if (quote) { if (ch === quote) quote = null; else current += ch; continue }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue }
    if (/\s/.test(ch)) { if (started) { out.push(current); current = ''; started = false } continue }
    current += ch
    started = true
  }
  if (started) out.push(current)
  return out
}

const joinCommand = (argv: readonly string[]) => argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
const toRow = (c: CheckSpec | CheckDraft): Row => ({ draft: { label: c.label, kind: c.kind, argv: [...c.argv], cwd: c.cwd, timeoutSec: c.timeoutSec, required: c.required }, command: joinCommand(c.argv) })

/** View, edit, reorder and test the commands Hydra runs to verify changes. */
export function ChecksPanel({ projectId, isGit }: { projectId: string; isGit: boolean }) {
  const { run } = useApp()
  const [info, setInfo] = useState<ChecksInfo | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const ack = await run({ type: 'project.checks.get', projectId })
    if (ack.ok) { const i = ack.result as ChecksInfo; setInfo(i); setRows(i.checks.map(toRow)); setDirty(false) }
  }
  useEffect(() => { void load() }, [projectId])

  const update = (index: number, patch: Partial<Row>) => { setRows(rows.map((r, i) => (i === index ? { ...r, ...patch, result: undefined } : r))); setDirty(true) }
  const setDraft = (index: number, patch: Partial<CheckDraft>) => update(index, { draft: { ...rows[index]!.draft, ...patch } })
  const move = (index: number, by: number) => {
    const next = [...rows]
    const [row] = next.splice(index, 1)
    next.splice(index + by, 0, row!)
    setRows(next); setDirty(true)
  }
  const drafts = () => rows.map((r) => ({ ...r.draft, argv: splitCommand(r.command) }))

  const save = async (checks: CheckDraft[] | null, message: string) => {
    setBusy(true)
    const ack = await run({ type: 'project.checks.set', projectId, checks }, message)
    setBusy(false)
    if (ack.ok) await load()
  }
  const test = async (index: number) => {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, testing: true, result: undefined } : r)))
    const ack = await run({ type: 'project.checks.test', projectId, check: drafts()[index] })
    setRows((current) => current.map((r, i) => (i === index ? { ...r, testing: false, result: ack.ok ? (ack.result as TestResult) : undefined } : r)))
  }

  return (
    <Panel title="Verification" actions={info && <Badge tone="neutral" plain>Using {SOURCE[info.source]}</Badge>}>
      <p className="muted" style={{ fontSize: 13 }}>
        Hydra runs these commands itself on every change and shows you the real results. They run with your user's permissions, in a throwaway copy of the project, without a shell, and without your AI provider credentials. Commands that plainly delete files, change permissions, publish or use the network are refused, but Hydra cannot see what a program or script does once it runs: the copy decides where it starts, not what it can reach. Only add commands you trust; <b>Test</b> runs one right away.
      </p>
      {info?.problem && <Callout tone="bad">{info.problem}</Callout>}
      {!rows.length && <Callout tone="warn">No checks: Hydra cannot verify changes in this project. Add the command you use to run your tests.</Callout>}
      <div className="checks-list" data-unsaved={dirty ? 'true' : undefined}>
        {rows.map((row, i) => (
          <div key={i} className="checks-row">
            <div className="checks-row__fields">
              <input className="hx-input" aria-label="Name" value={row.draft.label} onChange={(e) => setDraft(i, { label: e.target.value })} />
              <input className="hx-input mono" aria-label="Command" placeholder="npm test" value={row.command} onChange={(e) => update(i, { command: e.target.value })} />
              <input className="hx-input mono" aria-label="Folder" title="Folder inside the project" value={row.draft.cwd} onChange={(e) => setDraft(i, { cwd: e.target.value })} />
              <select className="hx-select" aria-label="Kind" value={row.draft.kind} onChange={(e) => setDraft(i, { kind: e.target.value as CheckDraft['kind'] })}>
                {(['test', 'build', 'typecheck', 'lint'] as const).map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <label className="row" style={{ fontSize: 13 }} title="A required check must pass before Hydra treats a change as verified"><input type="checkbox" checked={row.draft.required} onChange={(e) => setDraft(i, { required: e.target.checked })} /> Required</label>
            </div>
            <div className="row">
              <Button size="sm" variant="ghost" aria-label="Move up" icon={<ArrowUp size={14} />} disabled={i === 0} onClick={() => move(i, -1)} />
              <Button size="sm" variant="ghost" aria-label="Move down" icon={<ArrowDown size={14} />} disabled={i === rows.length - 1} onClick={() => move(i, 1)} />
              <Button size="sm" icon={<FlaskConical size={14} />} busy={row.testing} disabled={!isGit || !row.command.trim()} onClick={() => void test(i)}>Test</Button>
              <Button size="sm" variant="ghost" aria-label="Remove" icon={<Trash2 size={14} />} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true) }} />
            </div>
            {row.result && (
              <div className={`checks-result ${row.result.passed ? 'is-ok' : 'is-bad'}`} role="status">
                <b>{row.result.passed ? 'Passed' : row.result.timedOut ? 'Timed out' : row.result.spawnError ? 'Could not run' : `Failed (exit ${row.result.exitCode})`}</b>
                <span className="faint"> in {(row.result.durationMs / 1000).toFixed(1)} s on commit {row.result.commit}</span>
                {row.result.spawnError && <div>{row.result.spawnError}</div>}
                {row.result.warnings.map((w, j) => <div key={j} className="faint">{w}</div>)}
                {row.result.outputTail && <pre>{row.result.outputTail.slice(-1500)}</pre>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
        <Button size="sm" icon={<Plus size={14} />} onClick={() => { setRows([...rows, { draft: { label: 'Tests', kind: 'test', argv: [], cwd: '.', timeoutSec: 600, required: true }, command: '' }]); setDirty(true) }}>Add command</Button>
        <Button size="sm" variant="primary" icon={<Save size={14} />} busy={busy} disabled={!dirty} onClick={() => void save(drafts(), 'Verification commands saved')}>Save</Button>
        {info?.source === 'yours' && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => void save(null, 'Using automatic detection again')}>Restore automatic detection</Button>}
      </div>
      {!isGit && <p className="faint" style={{ fontSize: 12 }}>Testing commands needs a git repository with at least one commit.</p>}
    </Panel>
  )
}
