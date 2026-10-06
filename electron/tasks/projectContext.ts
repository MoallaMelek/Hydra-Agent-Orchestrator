import { execFileSync } from 'child_process'
import { readdir, readFile, lstat } from 'fs/promises'
import { join, relative } from 'path'
import { resolveContainedExistingPath } from '../security/pathPolicy'
import { createHash } from 'crypto'

export const sensitivePath = /(^|[\\/])(?:\.env(?:\..*)?|\.git|\.aws|\.ssh|\.codex|\.claude|node_modules|dist|out|coverage|credentials?|secrets?)([\\/]|$)|\.(?:pem|key|p12|pfx)$|(?:auth|token|service[-_]?account|credential|secret)[^\\/]*\.json$/i

/** Bounded, explicit context for tool-free providers; never follow symlinks or load credential files. */
export interface ProjectContext { repository: string; files: string[]; snapshot: string; changedFiles: string[]; omissions: string[]; fingerprint: string }
export async function collectProjectContext(root: string): Promise<ProjectContext> {
  let repository = 'Not a Git repository'
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true, maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'ignore'] })
  const changed = new Set<string>()
  const omissions: string[] = []
  try {
    repository = git(['status', '--short', '--branch']).slice(0, 8000)
    for (const args of [['diff', '--name-only', '-z', 'HEAD'], ['diff', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
      try { for (const file of git(args).split('\0').filter(Boolean)) changed.add(file) } catch { /* unborn HEAD */ }
    }
  } catch { /* optional Git */ }
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4 || files.length >= 240) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (sensitivePath.test(relative(root, path)) || entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(path, depth + 1)
      else if (entry.isFile() && /\.(?:tsx?|jsx?|json|md|css|html|py|rs|go|ya?ml|toml|txt)$/i.test(entry.name)) files.push(relative(root, path))
      if (files.length >= 240) break
    }
  }
  await walk(root, 0)
  let snapshot = ''
  const changedFiles = [...changed]
  const priority = [...new Set([...changedFiles, ...files])].filter(file => {
    if (sensitivePath.test(file)) { if (changed.has(file)) omissions.push(`${file}: excluded sensitive/generated path`); return false }
    return true
  }).sort((a, b) => Number(!changed.has(a)) - Number(!changed.has(b)) || Number(!/(?:package\.json|README|AGENTS|AI_TEAM)/i.test(a)) - Number(!/(?:package\.json|README|AGENTS|AI_TEAM)/i.test(b)))
  const hash = createHash('sha256').update(repository)
  for (const file of priority) {
    if (snapshot.length >= 90000) { omissions.push(`${file}: context budget exhausted`); continue }
    try {
      if (changed.has(file)) {
        let diff = ''
        try { diff = git(['diff', 'HEAD', '--', file]) } catch { try { diff = git(['diff', '--', file]) + git(['diff', '--cached', '--', file]) } catch { /* untracked */ } }
        hash.update(file).update(diff)
        if (diff) { snapshot += `\n--- DIFF ${file} ---\n${diff.slice(0, 18000)}\n`; if (diff.length > 18000) omissions.push(`${file}: diff truncated`) }
      }
      const contained = await resolveContainedExistingPath(root, file)
      const info = await lstat(contained.path)
      if (info.size > 1000000) { omissions.push(`${file}: file exceeds 1 MB`); continue }
      const raw = await readFile(contained.path, 'utf8')
      hash.update(file).update(raw)
      const content = raw.slice(0, Math.max(0, Math.min(changed.has(file) ? 18000 : 7000, 90000 - snapshot.length)))
      if (content.includes('\0')) continue
      if (content.length < raw.length) omissions.push(`${file}: file excerpt truncated`)
      snapshot += `\n--- ${file} (bounded excerpt) ---\n${content}\n`
    } catch { if (changed.has(file)) omissions.push(`${file}: deleted, unavailable or escaped project root (see diff)`); }
  }
  snapshot = `Changed files (tracked, deleted and untracked): ${JSON.stringify(changedFiles)}\nOmissions/truncation: ${JSON.stringify(omissions)}\n${snapshot}`
  return { repository, files: priority, snapshot, changedFiles, omissions, fingerprint: hash.digest('hex') }
}
