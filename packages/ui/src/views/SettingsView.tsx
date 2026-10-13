import { Fragment } from 'react'
import { Panel } from '../design/components'
import { useApp } from '../app/context'
import { MODE_INFO } from '../lib/format'

export function SettingsView() {
  const { state } = useApp()
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
      </Panel>
    </div>
  )
}
