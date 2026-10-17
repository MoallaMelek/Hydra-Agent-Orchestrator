import { DesktopUpdatesPanel } from './DesktopUpdatesPanel'
import { SavedDraftsPanel } from './SavedDraftsPanel'
import { useTheme, setTheme, type Theme } from '../app/preferences'
import { Fragment, useEffect, useState } from 'react'
import { Button, Panel, Segmented } from '../design/components'
import { setChoice, useQuality, type QualityChoice } from '../app/quality'
import { useApp, useAppState } from '../app/context'
import { HttpTransport } from '../api/transport'
import { MODE_INFO } from '../lib/format'

export function SettingsView() {
  const { store, isRemote, run } = useApp()
  const engineVersion = useAppState((s) => s.engineVersion)
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
    <div className="page settings-workspace">
      <div className="page__head"><div className="page__title"><h1>Settings</h1><p className="muted">Engine v{engineVersion}</p></div></div>
      <DisplayPanel />
      <SavedDraftsPanel />
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
      {!isRemote && <DesktopUpdatesPanel />}
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

/** Visual quality: lower levels remove motion and per-tool marks, never information. */
function DisplayPanel() {
  const theme = useTheme()
  const [choice, effective] = useQuality()
  return (
    <Panel title="Display">
      <Segmented<Theme> label="Color theme" value={theme} onChange={setTheme} options={[{value: 'dark', label: 'Midnight'}, {value: 'light', label: 'Light'}, {value: 'terracotta', label: 'Terracotta'}]} />
      <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <p className="muted" style={{ maxWidth: '62ch' }}>Visual quality of the live views. Auto follows your system's reduced-motion setting and switches to Minimal if this computer starts missing frames. Lower levels remove animation and tool-call marks; every piece of information stays.</p>
        <Segmented<QualityChoice> label="Visual quality" value={choice} onChange={setChoice} options={[
          { value: 'auto', label: 'Auto' }, { value: 'full', label: 'Full' }, { value: 'reduced', label: 'Reduced' }, { value: 'minimal', label: 'Minimal' }
        ]} />
      </div>
      {choice === 'auto' && <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>Now: {effective}.</p>}
    </Panel>
  )
}
