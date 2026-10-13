import { useState } from 'react'
import { CheckCircle2, Circle, RefreshCw } from 'lucide-react'
import type { ProviderStatus } from '@hydra/protocol'
import { Badge, Button, Panel } from '../design/components'
import { useApp } from '../app/context'

/** How a customer installs and signs in to each CLI with their own account. Hydra never sees the credentials. */
const SETUP: Record<string, { install: string; signIn: string; signInNote: string }> = {
  claude: { install: 'npm install -g @anthropic-ai/claude-code', signIn: 'claude', signInNote: 'then follow the sign-in prompt' },
  codex: { install: 'npm install -g @openai/codex', signIn: 'codex login', signInNote: '' }
}

export function providerReady(p: ProviderStatus): boolean {
  return p.installed && p.problems.length === 0
}

function ProviderStep({ p }: { p: ProviderStatus }) {
  const ready = providerReady(p)
  const setup = SETUP[p.id]
  const label = ready ? 'Ready' : !p.installed ? 'Not installed' : p.authenticated === false ? 'Not signed in' : 'Needs attention'
  return (
    <li className="setup-step">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{p.displayName}</strong>
        <Badge tone={ready ? 'ok' : p.installed ? 'warn' : 'neutral'}>{label}</Badge>
      </div>
      {!ready && setup && (
        <ol className="muted setup-commands">
          {!p.installed && <li>Install: <code>{setup.install}</code></li>}
          {p.authenticated !== true && <li>Sign in with your own account: <code>{setup.signIn}</code>{setup.signInNote && ` ${setup.signInNote}`}</li>}
        </ol>
      )}
      {!ready && p.installed && p.problems.map((problem, i) => <p key={i} className="faint" style={{ fontSize: 12 }}>{problem}</p>)}
    </li>
  )
}

/** First-run guidance: at least one agent CLI ready, then a project. */
export function SetupChecklist({ onAddProject }: { onAddProject?: () => void }) {
  const { state, run, isRemote } = useApp()
  const [busy, setBusy] = useState(false)
  const anyReady = state.providers.some(providerReady)
  const hasProject = state.projects.length > 0
  const refresh = async () => { setBusy(true); await run({ type: 'providers.refresh' }); setBusy(false) }
  const mark = (done: boolean) => done ? <CheckCircle2 size={18} aria-label="Done" color="var(--ok)" /> : <Circle size={18} aria-label="To do" />

  return (
    <Panel title="Get started" actions={<Button size="sm" icon={<RefreshCw size={14} />} busy={busy} onClick={() => void refresh()}>Re-check</Button>}>
      <ol className="setup-list">
        <li>
          <div className="row">{mark(anyReady)}<span>Install and sign in to at least one agent: Claude Code or Codex.</span></div>
          <p className="faint" style={{ fontSize: 12, margin: '4px 0 8px 26px' }}>Hydra uses your own subscriptions. Your logins stay in each CLI; Hydra never reads or stores them. After installing or signing in, press Re-check.</p>
          <ul className="setup-providers">{state.providers.map((p) => <ProviderStep key={p.id} p={p} />)}</ul>
        </li>
        <li>
          <div className="row">{mark(hasProject)}<span>Add a project: any folder that is a git repository with at least one commit.</span></div>
          {!hasProject && onAddProject && !isRemote && <div style={{ margin: '8px 0 0 26px' }}><Button variant="primary" onClick={onAddProject}>Add a project</Button></div>}
        </li>
        <li>
          <div className="row">{mark(false)}<span>Start a task in <strong>Safe</strong> mode. You approve the plan first and the final change last; your branch is untouched until you accept.</span></div>
        </li>
      </ol>
    </Panel>
  )
}
