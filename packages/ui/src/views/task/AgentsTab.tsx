import { Bot } from 'lucide-react'
import type { AgentRunInfo } from '@hydra/protocol'
import { Badge, EmptyState, type Tone } from '../../design/components'
import { useAppState } from '../../app/context'
import { duration, money, STAGE_LABELS, tokens } from '../../lib/format'

const STATUS_TONE: Record<AgentRunInfo['status'], Tone> = { running: 'accent', succeeded: 'ok', failed: 'bad', canceled: 'neutral', interrupted: 'warn' }

/** Every agent run with its role, real usage and live output. */
export function AgentsTab({ runs }: { runs: AgentRunInfo[] }) {
  const providers = useAppState((s) => s.providers)
  const outputs = useAppState((s) => s.output)
  if (!runs.length) return <EmptyState icon={<Bot size={28} />} title="No agent has run yet" />
  const name = (id: string) => providers.find((p) => p.id === id)?.displayName ?? id
  return (
    <div>
      {[...runs].reverse().map((run) => {
        const live = outputs[run.id]
        const ended = run.endedAt ? Date.parse(run.endedAt) : Date.now()
        return (
          <section key={run.id} className="run">
            <header className="run__head">
              <Badge tone={STATUS_TONE[run.status]} live={run.status === 'running'}>{run.status}</Badge>
              <b>{name(run.provider)}</b>
              <span className="muted">{run.role} · {STAGE_LABELS[run.stage]}</span>
              {run.model && <span className="faint mono" style={{ fontSize: 11.5 }}>{run.model}</span>}
              <span className="grow" />
              <span className="faint" style={{ fontSize: 12 }}>
                {tokens(run.usage.inputTokens + run.usage.outputTokens)} tokens · {run.usage.unpricedTokens ? 'cost not reported' : money(run.usage.costUsd)} · {duration(ended - Date.parse(run.startedAt))}
              </span>
            </header>
            <div className="run__body">
              {run.error && <p style={{ color: 'var(--bad)', fontSize: 12.5, marginBottom: 8 }}>{run.error}</p>}
              <pre className="hx-log" style={{ maxHeight: 280 }}>{(live && run.status === 'running' ? live : run.tail) || '(no output)'}</pre>
            </div>
          </section>
        )
      })}
    </div>
  )
}
