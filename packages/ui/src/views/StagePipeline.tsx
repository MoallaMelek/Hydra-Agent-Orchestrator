import { Check, CircleDot, X, Pause, Minus } from 'lucide-react'
import type { Task, TaskStage } from '@hydra/protocol'
import { STAGE_LABELS } from '../lib/format'

const PIPELINE: TaskStage[] = ['plan', 'implement', 'review', 'fix', 'verify', 'demo', 'approval']
type NodeState = 'done' | 'active' | 'waiting' | 'failed' | 'skipped' | 'pending'

function stateOf(task: Task, stage: TaskStage): { state: NodeState; attempts: number } {
  const records = task.stages.filter((s) => s.stage === stage)
  const last = records.at(-1)
  const attempts = records.length
  if (stage === 'approval') {
    if (task.status === 'waiting_input' && task.waitReason === 'final_approval') return { state: 'waiting', attempts }
    if (task.outcome === 'applied' || task.outcome === 'rolled_back' || task.outcome === 'kept_branch') return { state: 'done', attempts }
    if (task.outcome === 'discarded' && task.demo) return { state: 'failed', attempts }
    return { state: 'pending', attempts }
  }
  if (stage === 'plan' && task.status === 'waiting_input' && task.waitReason === 'plan_approval') return { state: 'waiting', attempts }
  if (!last) {
    const later = PIPELINE.indexOf(stage) < PIPELINE.indexOf(task.stage === 'apply' ? 'approval' : task.stage)
    return { state: stage === 'fix' && later ? 'skipped' : 'pending', attempts }
  }
  if (last.status === 'running') return { state: 'active', attempts }
  if (last.status === 'failed' || last.status === 'interrupted') return { state: 'failed', attempts }
  if (last.status === 'canceled') return { state: 'failed', attempts }
  return { state: 'done', attempts }
}

const ICON: Record<NodeState, React.ReactNode> = {
  done: <Check size={13} strokeWidth={2.5} />,
  active: <CircleDot size={13} />,
  waiting: <Pause size={12} />,
  failed: <X size={13} strokeWidth={2.5} />,
  skipped: <Minus size={13} />,
  pending: null
}

/** The seven-stage lifecycle with live state, attempts and the current wait point. */
export function StagePipeline({ task, compact = false }: { task: Task; compact?: boolean }) {
  const stages = task.intent === 'analyze' ? (['plan'] as TaskStage[]) : PIPELINE
  return (
    <ol className={`pipeline ${compact ? 'pipeline--compact' : ''}`} aria-label="Task lifecycle">
      {stages.map((stage) => {
        const { state, attempts } = stateOf(task, stage)
        return (
          <li key={stage} className={`pipeline__step pipeline__step--${state}`} aria-current={state === 'active' || state === 'waiting' ? 'step' : undefined}>
            <span className="pipeline__node">{ICON[state]}</span>
            {!compact && (
              <span className="pipeline__label">
                {stage === 'plan' && task.intent === 'analyze' ? 'Answer' : STAGE_LABELS[stage]}
                {attempts > 1 && <span className="pipeline__attempts">×{attempts}</span>}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
