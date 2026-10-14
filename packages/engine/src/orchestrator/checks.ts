import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { CheckSpec, Evidence, Task } from '@hydra/protocol'
import { outsideLinks, trackedChanges } from '../isolation/git.js'
import { checkDefinitionDigest } from '../verification/detect.js'
import { runChecks } from '../verification/runner.js'
import { isoNow, newId } from '../util/ids.js'
import { type EngineContext, logTask } from './context.js'

const EMPTY_SHA256 = createHash('sha256').digest('hex')

function refused(task: Task, spec: CheckSpec, phase: Evidence['phase'], sha: string, reason: string): Evidence {
  return {
    id: newId(), taskId: task.id, checkId: spec.id, label: spec.label, phase, commitSha: sha, argv: spec.argv, cwd: spec.cwd,
    startedAt: isoNow(), durationMs: 0, exitCode: null, timedOut: false, spawnError: reason, outputTail: '', outputBytes: 0,
    outputSha256: EMPTY_SHA256, outputTruncated: false, treeMutated: false, required: spec.required
  }
}

/**
 * Runs the task's checks against exactly `sha` in a throwaway checkout. Each check is
 * followed by a tracked-file mutation test. In Safe mode, checks whose definitions
 * changed since the human approved them are not executed at all.
 */
export async function runChecksAt(ctx: EngineContext, task: Task, sha: string, phase: Evidence['phase'], signal: AbortSignal): Promise<Evidence[]> {
  if (!task.checks.length) return []
  const root = ctx.store.getProject(task.projectId)!.root
  // A link to somewhere outside the project could let a check read or write anywhere: refuse to run.
  const base = task.workspace?.baseSha
  const links = base && base !== sha ? await outsideLinks(root, base, sha) : []
  if (links.length) {
    const list = links.map((l) => `${l.path} → ${l.target}`).join(', ')
    logTask(ctx, task.id, 'error', `The change adds a link to a location outside the project (${list}). Hydra will not run checks on it or apply it.`)
    const evidence = task.checks.map((spec) => refused(task, spec, phase, sha, `Not executed: the change adds a link outside the project (${list}). Remove it.`))
    for (const item of evidence) ctx.store.putEvidence(item)
    return evidence
  }
  const { result } = await ctx.workspaces.withCheckout(root, sha, async (dir) => {
    const digest = checkDefinitionDigest(dir)
    const changed = task.checkDigest !== null && digest !== task.checkDigest
    if (changed) {
      logTask(ctx, task.id, 'warn', task.mode === 'safe'
        ? 'Check definitions (scripts or build files) changed after you approved them. In Safe mode Hydra will not run the changed checks.'
        : 'Check definitions (scripts or build files) were changed by the agent since planning. Review those changes carefully.')
    }
    const evidence: Evidence[] = []
    let mutated = false
    for (const spec of task.checks) {
      if (signal.aborted) break
      if (changed && task.mode === 'safe') {
        const item = refused(task, spec, phase, sha, 'Not executed: check definitions changed after approval (Safe mode)')
        ctx.store.putEvidence(item)
        evidence.push(item)
        continue
      }
      const [item] = await runChecks([spec], {
        taskId: task.id, workspacePath: dir, commitSha: sha, phase,
        logsDir: join(ctx.paths.logs, task.id), scratchDir: join(ctx.paths.scratch, task.id, phase), signal, env: ctx.env
      })
      if (!item) break
      mutated = mutated || await trackedChanges(dir)
      const final = mutated ? { ...item, treeMutated: true } : item
      if (mutated) logTask(ctx, task.id, 'warn', `${spec.label} modified tracked files in its checkout; its result (and later ones) are flagged as untrustworthy.`)
      ctx.store.putEvidence(final)
      evidence.push(final)
    }
    return evidence
  })
  return result
}
