import { useEffect, useState } from 'react'
import { Button, Panel } from '../design/components'
import { useApp, useAppState } from '../app/context'
import type { DesktopUpdateState, UpdateAction } from '../app/updateTypes'
import { Markdown } from '../lib/markdown'

const STATUS: Record<DesktopUpdateState['status'], string> = { idle: 'Ready to check', checking: 'Checking the publisher’s releases', available: 'An update is available', downloading: 'Downloading and verifying', downloaded: 'Ready when you are', preparing: 'Saving work and preparing a safe restart', installing: 'Installing and restarting', error: 'Update needs attention', not_configured: 'Updates need one-time setup' }

export function DesktopUpdatesPanel() {
  const { host } = useApp()
  const version = useAppState(state => state.engineVersion)
  const [state, setState] = useState<DesktopUpdateState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!host.updates) return
    let current = true
    void host.updates.state().then(value => { if (current) setState(value) }).catch(e => setError((e as Error).message))
    const unsubscribe = host.updates.subscribe(setState)
    return () => { current = false; unsubscribe() }
  }, [host])
  const action = async (value: UpdateAction) => {
    if (!host.updates || busy) return
    setBusy(true); setError('')
    try { setState(await host.updates.action(value)) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const working = state && ['checking', 'downloading', 'preparing', 'installing'].includes(state.status)
  const percent = state?.total ? Math.min(100, state.transferred / state.total * 100) : null
  const status = state?.status === 'idle' && state.latestVersion === state.currentVersion ? 'You’re up to date' : state ? STATUS[state.status] : host.updates ? 'Loading update state…' : 'Desktop updater unavailable in this browser'
  return <Panel title="Updates">
    <dl className="hx-kv"><dt>Installed</dt><dd>Hydra {state?.currentVersion ?? version}</dd><dt>Latest available</dt><dd>{state?.latestVersion ?? 'Not checked'}</dd><dt>Channel</dt><dd>{state?.channel ?? 'This build'}</dd><dt>Status</dt><dd role="status">{status}</dd></dl>
    <p className="muted" style={{ marginTop: 16 }}>You choose when Hydra restarts. Active tasks and unsent drafts block installation. Projects, sign-ins, conversation history and settings stay on this computer; Hydra saves a database backup before updating.</p>
    {state && <div className="col" style={{ marginTop: 16 }}>
      <label><input type="checkbox" checked={state.autoCheck} disabled={busy} onChange={event => void action(event.target.checked ? 'auto-check-on' : 'auto-check-off')} /> Check automatically after startup and every six hours</label>
      <label><input type="checkbox" checked={state.autoDownload} disabled={busy} onChange={event => void action(event.target.checked ? 'auto-download-on' : 'auto-download-off')} /> Download verified updates in the background</label>
    </div>}
    {state?.status === 'downloading' && <div style={{ marginTop: 16 }}><progress aria-label="Update download" max={state.total || 1} value={state.transferred} /><span className="num muted"> {percent?.toFixed(1) ?? '0'}% · {(state.transferred / 1048576).toFixed(1)} / {(state.total / 1048576).toFixed(1)} MB</span></div>}
    {(error || state?.error) && <p role="alert" className="update-error">{error || state?.error}</p>}
    {state?.recovery && <p className="muted" style={{ marginTop: 12 }}>{state.recovery}</p>}
    {state?.notes && <details style={{ marginTop: 16 }}><summary>Release notes · {state.latestVersion}</summary><Markdown text={state.notes} /></details>}
    <div className="row" style={{ marginTop: 16, flexWrap: 'wrap' }}>
      <Button disabled={!host.updates || Boolean(working) || busy} onClick={() => void action('check')}>Check for Updates</Button>
      {state?.latestVersion && state.latestVersion !== state.currentVersion && state.status !== 'downloaded' && <Button disabled={Boolean(working) || busy} onClick={() => void action('download')}>Download Update</Button>}
      {state?.status === 'downloaded' && <><Button variant="primary" disabled={busy} onClick={() => void action('install')}>Restart to Update</Button><span className="muted">Or keep working and install later.</span></>}
      {state?.status === 'downloading' && <Button onClick={() => { void host.updates?.action('cancel').then(setState) }}>Cancel download</Button>}
    </div>
  </Panel>
}
