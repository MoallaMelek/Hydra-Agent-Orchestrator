import { execFile } from 'node:child_process'
import type { DiffFile } from '@hydra/protocol'

export interface GitResult { code: number; stdout: string; stderr: string }

/** Identity used for Hydra-authored checkpoint commits inside task worktrees. */
const HYDRA_IDENTITY = ['-c', 'user.name=Hydra', '-c', 'user.email=hydra@localhost', '-c', 'commit.gpgsign=false']

export function git(cwd: string, args: string[], options: { allowFail?: boolean; maxBuffer?: number; env?: NodeJS.ProcessEnv } = {}): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], {
      cwd, windowsHide: true, maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024, timeout: 120_000,
      env: { ...(options.env ?? process.env), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((error as { code: number }).code) : 1) : 0
      const result = { code, stdout: String(stdout), stderr: String(stderr) }
      if (code !== 0 && !options.allowFail) reject(new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`))
      else resolve(result)
    })
  })
}

export async function isRepository(dir: string): Promise<boolean> {
  const result = await git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })
  return result.code === 0 && result.stdout.trim() === 'true'
}

export async function topLevel(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', '--show-toplevel'])).stdout.trim()
}

export async function headSha(dir: string): Promise<string | null> {
  const result = await git(dir, ['rev-parse', '--verify', 'HEAD'], { allowFail: true })
  return result.code === 0 ? result.stdout.trim() : null
}

export async function currentBranch(dir: string): Promise<string | null> {
  const result = await git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true })
  return result.code === 0 ? result.stdout.trim() : null
}

export async function isClean(dir: string): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain', '--untracked-files=normal'])).stdout.trim() === ''
}

/** Commits everything in the worktree under Hydra's identity. Returns the new SHA or null if nothing changed. */
export async function commitAll(dir: string, message: string, exclude: readonly string[] = []): Promise<string | null> {
  await git(dir, ['add', '-A'])
  // Paths Hydra linked into the worktree must never be committed: restore their index entries to HEAD.
  for (const path of exclude) await git(dir, ['reset', '-q', '--', path], { allowFail: true })
  const staged = await git(dir, ['diff', '--cached', '--quiet'], { allowFail: true })
  if (staged.code === 0) return null
  await git(dir, [...HYDRA_IDENTITY, 'commit', '--no-verify', '-q', '-m', message])
  return headSha(dir)
}

/** Parses `git diff base..head` into per-file patches (bounded). */
export async function diffFiles(dir: string, base: string, head: string, maxBytes = 2_000_000): Promise<{ files: DiffFile[]; truncated: boolean }> {
  const numstat = (await git(dir, ['diff', '--numstat', '-M', '-z', base, head])).stdout
  const status = (await git(dir, ['diff', '--name-status', '-M', '-z', base, head])).stdout
  const patch = (await git(dir, ['diff', '-M', '--no-color', '--unified=3', base, head], { maxBuffer: 64 * 1024 * 1024 })).stdout

  const stats = new Map<string, { add: number; del: number; binary: boolean }>()
  const numParts = numstat.split('\0')
  for (let i = 0; i < numParts.length; i++) {
    const entry = numParts[i]
    if (!entry) continue
    const [add, del, path] = entry.split('\t')
    if (path === '') { // rename: next two entries are old and new path
      const newPath = numParts[i + 2] ?? ''
      stats.set(newPath, { add: Number(add) || 0, del: Number(del) || 0, binary: add === '-' })
      i += 2
    } else if (path !== undefined) {
      stats.set(path, { add: Number(add) || 0, del: Number(del) || 0, binary: add === '-' })
    }
  }

  const files: DiffFile[] = []
  const statusParts = status.split('\0').filter((part) => part !== '')
  for (let i = 0; i < statusParts.length; i++) {
    const code = statusParts[i]!
    let path = statusParts[++i] ?? ''
    let oldPath: string | null = null
    if (code.startsWith('R') || code.startsWith('C')) {
      oldPath = path
      path = statusParts[++i] ?? ''
    }
    const stat = stats.get(path) ?? { add: 0, del: 0, binary: false }
    const kind: DiffFile['status'] = stat.binary ? 'binary' : code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : code.startsWith('R') ? 'renamed' : 'modified'
    files.push({ path, oldPath, status: kind, additions: stat.add, deletions: stat.del, patch: '' })
  }

  // Attach per-file patch text, splitting on "diff --git" headers.
  const chunks = patch.split(/^(?=diff --git )/m)
  let used = 0
  let truncated = false
  for (const chunk of chunks) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
    if (!header) continue
    const file = files.find((f) => f.path === header[2] || f.path === header[1])
    if (!file) continue
    if (used + chunk.length > maxBytes) { truncated = true; continue }
    used += chunk.length
    file.patch = chunk
  }
  return { files, truncated }
}

export async function addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  await git(repo, ['worktree', 'add', '-b', branch, path, base])
}

export async function removeWorktree(repo: string, path: string): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', path], { allowFail: true })
  await git(repo, ['worktree', 'prune'], { allowFail: true })
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  if (!branch.startsWith('hydra/')) throw new Error(`Refusing to delete non-Hydra branch ${branch}`)
  await git(repo, ['branch', '-D', branch], { allowFail: true })
}

export { HYDRA_IDENTITY }
