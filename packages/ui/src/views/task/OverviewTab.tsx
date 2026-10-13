import { ArrowRight } from 'lucide-react'
import type { DemoReport, Task } from '@hydra/protocol'
import { Badge, Callout, Panel, type Tone } from '../../design/components'
import type { Warning } from './warnings'

const SEVERITY_TONE: Record<string, Tone> = { blocker: 'bad', major: 'warn', minor: 'info', nit: 'neutral' }
const OUTCOME_TONE: Record<DemoReport['deltas'][number]['before'], Tone> = { pass: 'ok', fail: 'bad', error: 'warn', missing: 'neutral' }

export function OverviewTab({ task, warnings }: { task: Task; warnings: Warning[] }) {
  return (
    <div className="stack">
      {task.error && task.status !== 'waiting_input' && <Callout tone="bad"><b>{task.status === 'paused' ? 'Paused' : 'Problem'}:</b> {task.error}</Callout>}
      {warnings.length > 0 && task.status === 'waiting_input' && task.waitReason === 'final_approval' && (
        <div className="stack" style={{ gap: 8 }}>{warnings.map((w, i) => <Callout key={i} tone={w.tone}>{w.text}</Callout>)}</div>
      )}
      {task.answer && <Panel title="Answer"><div className="prose">{task.answer}</div></Panel>}
      <div className="grid-2">
        <div className="stack">
          {task.plan && (
            <Panel title="Plan">
              <div className="stack" style={{ gap: 12 }}>
                <p>{task.plan.summary}</p>
                <ol className="list-plain">{task.plan.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                <div><h4 style={{ marginBottom: 6 }}>Acceptance criteria</h4><ul className="list-plain">{task.plan.acceptanceCriteria.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
                {task.plan.risks.length > 0 && <div><h4 style={{ marginBottom: 6 }}>Risks</h4><ul className="list-plain muted">{task.plan.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
              </div>
            </Panel>
          )}
          {task.review && (
            <Panel title="Review" actions={<Badge tone={task.review.verdict === 'approve' ? 'ok' : 'warn'}>{task.review.verdict === 'approve' ? 'Approved' : 'Changes requested'}</Badge>}>
              <p style={{ marginBottom: 12 }}>{task.review.summary}</p>
              {task.review.findings.length === 0 ? <p className="muted">No findings.</p> : task.review.findings.map((f, i) => (
                <div className="finding" key={i}>
                  <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                  <div><div>{f.file && <code>{f.file}</code>} {f.issue}</div>{f.suggestion && <div className="muted" style={{ fontSize: 12.5 }}>→ {f.suggestion}</div>}</div>
                </div>
              ))}
            </Panel>
          )}
        </div>
        <div className="stack">
          {task.demo && (
            <Panel title="Before → after">
              <p className="muted" style={{ marginBottom: 12, fontSize: 12.5 }}>Hydra ran the same checks on the original commit and on the result.</p>
              {task.demo.deltas.map((d) => (
                <div key={d.checkId} className="spread" style={{ padding: '6px 0' }}>
                  <span className="mono truncate" style={{ fontSize: 12.5 }}>{d.label}</span>
                  <span className="delta"><Badge tone={OUTCOME_TONE[d.before]}>{d.before}</Badge><ArrowRight size={13} className="faint" /><Badge tone={OUTCOME_TONE[d.after]}>{d.after}</Badge></span>
                </div>
              ))}
              <p style={{ marginTop: 12, fontSize: 12.5 }}>{task.demo.narrative}</p>
            </Panel>
          )}
          {task.feedback.length > 0 && (
            <Panel title="Your feedback">
              <ul className="list-plain">{task.feedback.map((f, i) => <li key={i}><span className="faint" style={{ fontSize: 11 }}>{f.source} · {new Date(f.at).toLocaleString()}</span><div>{f.text}</div></li>)}</ul>
            </Panel>
          )}
          <Panel title="Request">
            <div className="prose" style={{ fontSize: 13 }}>{task.prompt}</div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
