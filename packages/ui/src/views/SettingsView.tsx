import { Fragment, useEffect, useState } from 'react'
import { Button, Panel } from '../design/components'
import { useApp } from '../app/context'
import { HttpTransport } from '../api/transport'
import { MODE_INFO } from '../lib/format'

export function SettingsView() {
  const { state, store, isRemote, run } = useApp()
  const [history, setHistory] = useState<{ count: number } | null>(null)
  const loadHistory = () => void store.transport.execute({ type: 'outcomes.get' }).then((ack) => { if (ack.ok) setHistory(ack.result as { count: number }) }).catch(() => {})
  useEffect(loadHistory, [store])
  const [busy, setBusy] = useState<'backup' | 'export' | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const transport = store.transport

  const save = async (kind: 'backup' | 'export') => {
    if (!(transport instanceof HttpTransport)) return
    setBusy(kind); setError(null); setSaved(null)
    try { setSaved((await transport.saveData(kind)).file) } catch (e) { setError((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="page">
      <div className="page__head"><div className="page__title"><h1>Settings</h1><p className="muted">Engine v{state.engineVersion}</p></div></div>
      <Panel title="Autonomy modes">
        <dl className="hx-kv">
          {(['safe', 'developer', 'autonomous'] as const).map((m) => <Fragment key={m}><dt>{MODE_INFO[m].label}</dt><dd>{MODE_INFO[m].detail}</dd></Fragment>)}
        </dl>
        <p className="faint" style={{ marginTop: 12, fontSize: 12 }}>Every mode keeps agents inside the task worktree and requires your final approval. These are enforced by the engine, not by instructions to the agents.</p>
      </Panel>
      <Panel title="Your data">
        <p className="muted">Tasks, history and evidence are stored only on this computer in a local SQLite database, with a daily backup. Nothing is sent to Hydra's developers or any cloud database. Agent prompts go only to the providers you selected, using your own accounts.</p>
        {!isRemote && (
          <>
            <div className="row" style={{ marginTop: 12 }}>
              <Button busy={busy === 'backup'} onClick={() => void save('backup')}>Back up now</Button>
              <Button busy={busy === 'export'} onClick={() => void save('export')}>Export as JSON</Button>
            </div>
            <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>Backups are standard SQLite files. The JSON export contains your projects, tasks, runs, evidence and audit trail, and leaves out keys. Both are saved in Hydra's backups folder, readable only by your user account.</p>
            {saved && <p className="muted" role="status" style={{ marginTop: 8, wordBreak: 'break-all' }}>Saved to <code>{saved}</code></p>}
            {error && <p role="alert" style={{ marginTop: 8, color: 'var(--bad)' }}>{error}</p>}
          </>
        )}
      </Panel>
      {!isRemote && <UpdatesPanel version={state.engineVersion} />}
      {!isRemote && (
        <Panel title="Task history used for suggestions">
          <p className="muted">Hydra keeps a short local record of each finished task (kind of task, which agents, time, cost, whether checks passed and whether you accepted). It never contains your prompts, code or answers, and never leaves this computer. Suggestions use it only once there are at least 5 similar tasks.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <span className="faint">{history ? `${history.count} record${history.count === 1 ? '' : 's'}` : '…'}</span>
            <Button size="sm" variant="ghost" disabled={!history?.count} onClick={() => void run({ type: 'outcomes.clear' }, 'Task history cleared').then(loadHistory)}>Clear history</Button>
          </div>
        </Panel>
      )}
    </div>
  )
}

/** Checks for a signed update only when asked. Installing is always the person's choice. */
function UpdatesPanel({ version }: { version: string }) {
  const { run } = useApp()
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true)
    const ack = await run({ type: 'update.check' })
    setBusy(false)
    if (!ack.ok) return
    const r = ack.result as { state: string; version?: string; reason?: string }
    setResult(r.state === 'available' ? `Version ${r.version} is available.` : r.state === 'up_to_date' ? 'You have the latest version.' : r.reason ?? 'Updates are not set up yet.')
  }
  return (
    <Panel title="Updates">
      <p className="muted">Hydra {version}. Hydra never checks for updates on its own and never installs anything without you. Updates must be signed by the Hydra publisher and match their published checksum.</p>
      <div className="row" style={{ marginTop: 12 }}>
        <Button size="sm" busy={busy} onClick={() => void check()}>Check for updates</Button>
        {result && <span className="faint" role="status">{result}</span>}
      </div>
    </Panel>
  )
}
