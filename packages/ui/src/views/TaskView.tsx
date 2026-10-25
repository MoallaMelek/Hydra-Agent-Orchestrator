import { EmptyState } from '../design/components'
import { useAppState } from '../app/context'
import { useTaskLoaded } from '../ops/hooks'
import { ConversationView } from './task/ConversationView'
import { MissionView } from './MissionView'

/** A question reads as a conversation; a change opens as a mission on the evidence map. */
export function TaskView({ taskId }: { taskId: string }) {
  const task = useAppState((s) => s.tasks[taskId])
  useTaskLoaded(taskId)
  if (!task) return <div className="page"><EmptyState title="Mission not found">It may have been deleted from history.</EmptyState></div>
  if (task.intent === 'analyze') return <div className="page page--wide task-page task-page--conversation"><ConversationView task={task} /></div>
  return <MissionView key={task.id} task={task} />
}
