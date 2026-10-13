import type { Task } from '@hydra/protocol'
import { Badge, type Tone } from '../../design/components'
import { useApp } from '../../app/context'
import { duration, STAGE_LABELS } from '../../lib/format'

const RECORD_TONE: Record<Task['stages'][number]['status'], Tone> = { running: 'accent', succeeded: 'ok', failed: 'bad', interrupted: 'warn', canceled: 'neutral', skipped: 'neutral' }
const LEVEL_COLOR = { info: 'var(--text-2)', warn: 'var(--warn)', error: 'var(--bad)' } as const

/** Stage history (durable) plus the engine's log lines for this task (this session). */
export function ActivityTab({ task }: { task: Task }) {
  const { state } = useApp()
  const logs = state.logs[task.id] ?? []
  return (
    <div className="grid-2">
      <div className="hx-panel">
        <div className="hx-panel__head"><h2 className="hx-panel__title">Stage history</h2></div>
        <table className="evidence">
          <thead><tr><th>Stage</th><th>Result</th><th>Started</th><th>Took</th></tr></thead>
          <tbody>
            {task.stages.map((s, i) => (
              <tr key={i}>
                <td>{STAGE_LABELS[s.stage]}{s.attempt > 1 ? ` #${s.attempt}` : ''}{s.note && <div className="faint" style={{ fontSize: 11.5 }}>{s.note}</div>}</td>
                <td><Badge tone={RECORD_TONE[s.status]} live={s.status === 'running'}>{s.status}</Badge></td>
                <td className="faint">{new Date(s.startedAt).toLocaleTimeString()}</td>
                <td className="faint">{duration((s.endedAt ? Date.parse(s.endedAt) : Date.now()) - Date.parse(s.startedAt))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hx-panel">
        <div className="hx-panel__head"><h2 className="hx-panel__title">Engine log</h2></div>
        <div className="hx-panel__body">
          {logs.length === 0 ? <p className="muted">Log lines appear here while this window is open. Stage history is kept permanently.</p> : (
            <ul className="list-plain" style={{ listStyle: 'none', paddingLeft: 0, fontSize: 12.5 }}>
              {logs.map((l, i) => <li key={i} style={{ color: LEVEL_COLOR[l.level] }}><span className="faint mono" style={{ fontSize: 11 }}>{new Date(l.at).toLocaleTimeString()} </span>{l.message}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
