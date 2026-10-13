import { readFile } from 'fs/promises'
import { join } from 'path'
import type { TaskEvidence } from '@shared/tasks'

/** A check is an intended executable action, not any string containing “test”. */
export async function projectVerificationPlan(root: string): Promise<string[]> {
  try {
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const scripts = packageJson.scripts ?? {}
    return ['test', 'typecheck', 'lint', 'build', 'check'].filter(name => typeof scripts[name] === 'string'
      && !/^\s*(?:echo|printf|cat|type)\b/i.test(scripts[name])
      && !/(?:git\s+push|\bdeploy\b|Remove-Item|rm\s+-[a-z]*r|curl\s|wget\s|\bnpx\s)/i.test(scripts[name]))
      .map(name => `npm run ${name}`)
  } catch { return [] }
}

export function normalizedCheckCommand(command: string): string | null {
  let text = command.trim()
  const shell = text.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))\s+((?:-NoProfile\s+)?(?:-lc|-c|-Command)\s+[\s\S]+)$/i)
  if (shell && /^(?:bash|sh|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/i.test((shell[1] || shell[2] || shell[3]).split(/[\\/]/).pop()!)) {
    text = shell[4].replace(/^(?:-NoProfile\s+)?(?:-lc|-c|-Command)\s+/i, '').trim()
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) text = text.slice(1, -1)
  }
  if (!/^npm(?:\.cmd)?\s+run\s+(?:test|typecheck|lint|build|check)$/.test(text)) return null
  return text.replace(/^npm\.cmd/, 'npm').replace(/\s+/g, ' ')
}

export function validateVerification(plan: string[], evidence: TaskEvidence[]): { ok: boolean; checks: TaskEvidence[]; reason: string } {
  const checks = evidence.filter(value => value.kind !== 'file' && !!normalizedCheckCommand(value.command) && plan.includes(normalizedCheckCommand(value.command)!))
  const missing = plan.filter(command => !checks.some(value => normalizedCheckCommand(value.command) === command && value.exitCode === 0))
  const failures = checks.filter(value => value.exitCode !== 0)
  return { ok: plan.length > 0 && !missing.length && !failures.length, checks,
    reason: !plan.length ? 'No recognized project check plan is available. File inspection cannot prove tests or build passed.' : failures.length ? 'An intended verification command failed.' : missing.length ? `No successful execution was observed for: ${missing.join(', ')}` : 'All planned project commands succeeded' }
}
