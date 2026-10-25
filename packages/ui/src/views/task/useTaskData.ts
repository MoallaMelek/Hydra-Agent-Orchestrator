import { useEffect, useState } from 'react'
import type { TaskDiff } from '@hydra/protocol'
import { useApp } from '../../app/context'

/** Loads the diff for the current head; refetches when the head commit changes. */
export function useTaskDiff(taskId: string, headSha: string | null | undefined, enabled: boolean): { diff: TaskDiff | null; error: string | null } {
  const { store } = useApp()
  const [state, setState] = useState<{ diff: TaskDiff | null; error: string | null }>({ diff: null, error: null })
  useEffect(() => {
    if (!enabled) return
    let live = true
    store.transport.taskDiff(taskId)
      .then((diff) => { if (live) setState({ diff, error: null }) })
      .catch((error: Error) => { if (live) setState({ diff: null, error: error.message }) })
    return () => { live = false }
  }, [store, taskId, headSha, enabled])
  return state
}
