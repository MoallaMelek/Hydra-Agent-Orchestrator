import type { Evidence, Task, TaskDiff } from '@hydra/protocol'
import { isTestPath } from '../../lib/format'

export interface Warning { tone: 'warn' | 'bad'; text: string }

const passed = (e: Evidence) => e.exitCode === 0 && !e.timedOut && !e.spawnError && !e.treeMutated

/**
 * Everything a reviewer should know before accepting, derived from facts the
 * engine recorded (never from agent claims).
 */
export function approvalWarnings(task: Task, evidence: readonly Evidence[], diff: TaskDiff | null): Warning[] {
  const out: Warning[] = []
  const head = task.workspace?.headSha
  const verify = evidence.filter((e) => e.phase === 'verify' && e.commitSha === head)
  const latest = new Map<string, Evidence>()
  for (const e of verify) latest.set(e.checkId, e)
  const failing = [...latest.values()].filter((e) => e.required && !passed(e))

  if (!task.checks.length) out.push({ tone: 'bad', text: 'No checks were detected, so behaviour was not verified by Hydra. Review the diff line by line or add .hydra/checks.json.' })
  if (failing.length) out.push({ tone: 'bad', text: `${failing.length} required check(s) are not passing at this commit: ${failing.map((e) => e.label).join(', ')}.` })
  if ([...latest.values()].some((e) => e.treeMutated)) out.push({ tone: 'bad', text: 'A check modified tracked files while running; its result is not trustworthy.' })
  if (evidence.some((e) => e.spawnError?.includes('definitions changed'))) out.push({ tone: 'bad', text: 'The agent changed how checks run (scripts or build files) after you approved them. Those checks were not executed.' })
  if (task.review?.verdict === 'changes_requested') out.push({ tone: 'warn', text: `The reviewer still requests changes (${task.review.findings.filter((f) => f.severity === 'blocker' || f.severity === 'major').length} blocking finding(s)).` })
  if (task.assignment.reviewer === task.assignment.implementer) out.push({ tone: 'warn', text: 'The reviewer used the same provider as the implementer, so the review is less independent.' })
  if (diff) {
    const tests = diff.files.filter((f) => isTestPath(f.path) && f.status !== 'added')
    if (tests.length) out.push({ tone: 'warn', text: `Existing test files were modified (${tests.map((f) => f.path).join(', ')}). Make sure tests were not weakened to pass.` })
    const config = diff.files.filter((f) => /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|CMakeLists\.txt|Makefile|\.hydra\/checks\.json)$/.test(f.path))
    if (config.length) out.push({ tone: 'warn', text: `Build or dependency configuration changed: ${config.map((f) => f.path).join(', ')}.` })
  }
  if (task.demo?.deltas.some((d) => d.before === 'pass' && d.after !== 'pass')) out.push({ tone: 'bad', text: 'Regression: a check that passed before this change no longer passes.' })
  return out
}
