import type { CheckDraft, CheckSpec, Project } from '@hydra/protocol'
import { detectChecks } from './detect.js'

/**
 * Commands that must never be a verification check: they delete or overwrite data,
 * change permissions, escalate privileges, publish, or talk to the network.
 */
const FORBIDDEN_PROGRAMS = new Set([
  'rm', 'rmdir', 'del', 'erase', 'rd', 'format', 'shutdown', 'reboot', 'halt', 'poweroff', 'mkfs', 'dd', 'diskpart',
  'sudo', 'su', 'doas', 'runas', 'chmod', 'chown', 'icacls', 'takeown', 'curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'nc', 'netcat'
])
const FORBIDDEN_SUBCOMMANDS: Array<[string, RegExp, string]> = [
  ['git', /^(push|reset|clean|checkout|switch|rebase|merge|commit|tag|remote|config)$/, 'changes your repository'],
  ['npm', /^(publish|unpublish|deprecate|owner|adduser|login|token)$/, 'publishes or changes your account'],
  ['pnpm', /^(publish)$/, 'publishes'], ['yarn', /^(publish|npm)$/, 'publishes'],
  ['cargo', /^(publish|yank|login|owner)$/, 'publishes'], ['docker', /^(push|login|rm|rmi|system)$/, 'pushes or deletes images'],
  ['gh', /.*/, 'acts on your GitHub account'], ['twine', /^upload$/, 'publishes']
]
const INLINE_CODE: Array<[RegExp, RegExp]> = [
  [/^(sh|bash|zsh|dash)$/, /^-c$/], [/^cmd$/, /^\/[ck]$/i], [/^(powershell|pwsh)$/, /^-(c|command|encodedcommand|e)$/i],
  [/^node$/, /^(-e|--eval|-p|--print)$/], [/^(python|python3|py)$/, /^-c$/], [/^(ruby|perl)$/, /^-e$/]
]

// Both separators on every platform: path.basename on POSIX would keep "C:\...\curl.exe" whole.
const program = (argv: readonly string[]) => ((argv[0] ?? '').split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')

/** Checks a command before it is saved or tested. Errors block it; warnings are shown. */
export function validateCheck(check: CheckDraft): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const name = program(check.argv)
  if (!check.argv.length || !check.argv[0]!.trim()) errors.push('Enter the command to run.')
  if (FORBIDDEN_PROGRAMS.has(name)) errors.push(`"${name}" cannot be a check: checks must not delete files, change permissions, gain privileges or use the network.`)
  for (const [tool, sub, why] of FORBIDDEN_SUBCOMMANDS) {
    // Any argument, not only the second: options can come first ("git -C ../other clean -fdx").
    const hit = name === tool ? check.argv.slice(1).find((a) => sub.test(a)) : undefined
    if (hit) errors.push(`"${tool} ${hit}" cannot be a check: it ${why}.`)
  }
  if (check.argv.some((a) => /[;&|`]|\$\(|>|</.test(a)) && !INLINE_CODE.some(([p]) => p.test(name))) {
    warnings.push('Arguments are passed as-is, without a shell: pipes, redirects and ";" are not interpreted.')
  }
  for (const [p, flag] of INLINE_CODE) {
    if (p.test(name) && check.argv.slice(1).some((a) => flag.test(a))) warnings.push('This runs inline code. Prefer a script file in your project so the command is reviewable.')
  }
  const cwd = check.cwd.replaceAll('\\', '/')
  if (cwd.startsWith('/') || /^[A-Za-z]:/.test(cwd) || cwd.split('/').includes('..')) errors.push('The folder must be inside the project (for example "." or "packages/api").')
  return { errors, warnings }
}

/** The person's own list for a project, in the engine's format. */
export function specsFromDrafts(drafts: readonly CheckDraft[]): CheckSpec[] {
  return drafts.map((d, i) => ({
    id: `yours:${i}:${d.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 80),
    ecosystem: 'custom', kind: d.kind, label: d.label, argv: [...d.argv], cwd: d.cwd || '.', timeoutSec: d.timeoutSec, required: d.required
  }))
}

export type CheckSource = 'yours' | 'file' | 'detected'

/** Which checks apply to a project: your list in Hydra, else .hydra/checks.json, else detection. */
export function checksFor(project: Project, dir: string): { source: CheckSource; checks: CheckSpec[] } {
  if (project.checks) return { source: 'yours', checks: specsFromDrafts(project.checks) }
  const checks = detectChecks(dir)
  return { source: checks.some((c) => c.id.startsWith('custom:')) ? 'file' : 'detected', checks }
}
