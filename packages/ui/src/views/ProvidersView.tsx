import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Badge, Button, Callout, Panel } from '../design/components'
import { useApp, useAppState } from '../app/context'
import { ProviderStep } from './SetupChecklist'

const CAPABILITY_LABEL: Record<string, string> = {
  structuredOutput: 'Structured output',
  osSandbox: 'OS sandbox',
  fileToolConfinement: 'File access confined to worktree',
  reportsUsage: 'Reports token usage',
  reportsCost: 'Reports cost'
}

/** Which agent CLIs are installed and signed in. Hydra never sees the credentials. */
export function ProvidersView() {
  const { run } = useApp()
  const providers = useAppState((s) => s.providers)
  const [busy, setBusy] = useState(false)
  const refresh = async () => { setBusy(true); await run({ type: 'providers.refresh' }); setBusy(false) }
  return (
    <div className="page providers-workspace">
      <div className="page__head">
        <div className="page__title"><h1>AI accounts</h1><p className="muted">Hydra drives the Claude Code and Codex CLIs installed on this computer, signed in with your own accounts.</p></div>
        <Button icon={<RefreshCw size={14} />} busy={busy} onClick={() => void refresh()}>Re-check</Button>
      </div>
      <Callout tone="info">Your provider logins stay in each CLI's own credential store. Hydra only asks each CLI whether it is signed in; it never reads, stores or transmits keys, tokens or account details. Usage is billed to your own provider account.</Callout>
      <div className="grid-2">
        {providers.map((p) => {
          const ready = p.installed && p.problems.length === 0
          return (
            <Panel key={p.id} title={p.displayName} actions={<Badge tone={ready ? 'ok' : p.installed ? 'warn' : 'bad'}>{ready ? 'Ready' : p.installed ? 'Needs attention' : 'Not installed'}</Badge>}>
              <div className="provider-card">
                <ul className="account-setup"><ProviderStep p={p} /></ul>
                <details className="disclosure"><summary>Connection details <span>Version, location and restrictions</span></summary>
                <dl className="hx-kv">
                  <dt>Version</dt><dd className="mono">{p.version ?? '—'}</dd>
                  <dt>Signed in</dt><dd>{p.authenticated === null ? 'Unknown' : p.authenticated ? `Yes${p.authMethod ? ` (${p.authMethod})` : ''}` : 'No'}</dd>
                  <dt>Executable</dt><dd className="mono faint" style={{ fontSize: 11.5 }}>{p.path ?? '—'}</dd>
                </dl>
                <div className="cap-list">
                  {Object.entries(p.capabilities).map(([key, on]) => <Badge key={key} tone={on ? 'accent' : 'neutral'} plain={!on}>{on ? '' : 'No '}{CAPABILITY_LABEL[key] ?? key}</Badge>)}
                </div>
                {p.problems.map((problem, i) => <Callout key={i} tone="warn">{problem}</Callout>)}
                {p.id === 'claude' && <p className="faint" style={{ fontSize: 12 }}>Claude never gets a shell in Hydra: its file tools are restricted to the task worktree by Claude Code's own permission system.</p>}
                {p.id === 'codex' && <p className="faint" style={{ fontSize: 12 }}>Codex runs in its OS sandbox with network access off. Its CLI reports tokens but not prices, so Codex usage is limited by the token budget.</p>}
                </details>
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
