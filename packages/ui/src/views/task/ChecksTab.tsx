import { useState } from 'react'
import { ChevronDown, ChevronRight, FlaskConical } from 'lucide-react'
import type { Evidence, Task } from '@hydra/protocol'
import { Badge, Button, Callout, EmptyState, type Tone } from '../../design/components'
import { useApp } from '../../app/context'
import { duration, shortSha } from '../../lib/format'

const PHASE_LABEL: Record<Evidence['phase'], string> = { pre_review: 'Before review', verify: 'Verification', demo_base: 'Original commit', demo_final: 'Result' }

function verdict(e: Evidence): { label: string; tone: Tone } {
  if (e.spawnError) return { label: 'Not run', tone: 'warn' }
  if (e.timedOut) return { label: 'Timed out', tone: 'bad' }
  if (e.treeMutated) return { label: 'Untrusted', tone: 'bad' }
  return e.exitCode === 0 ? { label: 'Passed', tone: 'ok' } : { label: `Exit ${e.exitCode}`, tone: 'bad' }
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const { store } = useApp()
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState<string | null>(null)
  const v = verdict(evidence)
  const loadLog = async () => {
    try { setLog(await store.transport.evidenceLog(evidence.id)) } catch (error) { setLog(`Log unavailable: ${(error as Error).message}`) }
  }
  return (
    <>
      <tr>
        <td><Button variant="ghost" size="sm" aria-label={open ? 'Collapse' : 'Expand'} icon={open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} onClick={() => setOpen(!open)} /></td>
        <td><span className="mono">{evidence.label}</span>{!evidence.required && <span className="faint"> · optional</span>}</td>
        <td><Badge tone={v.tone}>{v.label}</Badge></td>
        <td className="mono faint">{shortSha(evidence.commitSha)}</td>
        <td className="faint">{duration(evidence.durationMs)}</td>
      </tr>
      {open && (
        <tr>
          <td />
          <td colSpan={4}>
            <div className="stack" style={{ gap: 8, paddingBottom: 8 }}>
              <div className="faint mono" style={{ fontSize: 12 }}>$ {evidence.argv.join(' ')} <span>(cwd {evidence.cwd})</span></div>
              {evidence.spawnError && <Callout tone="warn">{evidence.spawnError}</Callout>}
              {evidence.outputTruncated && <Callout tone="info">Output exceeded the log quota and was cut off; the exit code is still authoritative.</Callout>}
              <pre className="hx-log">{log ?? (evidence.outputTail || '(no output)')}</pre>
              <div className="spread">
                <span className="faint mono" style={{ fontSize: 11 }}>sha256 {evidence.outputSha256.slice(0, 16)}… · {evidence.outputBytes} bytes</span>
                {log === null && evidence.outputBytes > 0 && <Button size="sm" onClick={() => void loadLog()}>Full log</Button>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/** Every check result Hydra observed itself, grouped by phase, newest attempt first. */
export function ChecksTab({ task, evidence }: { task: Task; evidence: Evidence[] }) {
  if (!task.checks.length) {
    return <EmptyState icon={<FlaskConical size={28} />} title="No checks detected">Hydra found no test or build commands in this project. Add a <code>.hydra/checks.json</code> with the commands you trust, and Hydra will run them itself and record the results.</EmptyState>
  }
  const phases = (['verify', 'pre_review', 'demo_base'] as const).filter((p) => evidence.some((e) => e.phase === p))
  return (
    <div className="stack">
      <div className="hx-panel"><div className="hx-panel__body">
        <h4 style={{ marginBottom: 8 }}>Planned checks</h4>
        <ul className="list-plain mono" style={{ fontSize: 12.5 }}>
          {task.checks.map((c) => <li key={c.id}>{c.argv.join(' ')} <span className="faint">({c.kind}{c.required ? ', required' : ', optional'}, {c.timeoutSec}s limit)</span></li>)}
        </ul>
        {task.mode === 'safe' && <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>Safe mode: these exact definitions were {task.checksApproved ? 'approved by you' : 'not yet approved'}; if an agent changes them, Hydra will not run them.</p>}
      </div></div>
      {phases.length === 0 && <p className="muted">No checks have run yet.</p>}
      {phases.map((phase) => (
        <div key={phase} className="hx-panel">
          <div className="hx-panel__head"><h2 className="hx-panel__title">{PHASE_LABEL[phase]}</h2></div>
          <table className="evidence">
            <thead><tr><th style={{ width: 36 }} /><th>Command</th><th>Result</th><th>Commit</th><th>Time</th></tr></thead>
            <tbody>{evidence.filter((e) => e.phase === phase).slice().reverse().map((e) => <EvidenceRow key={e.id} evidence={e} />)}</tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
