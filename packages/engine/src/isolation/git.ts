import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DiffFile } from '@hydra/protocol'

export interface GitResult { code: number; stdout: string; stderr: string }

/** Pins a command to a specific worktree so a tampered `.git` pointer file cannot redirect it. */
export interface GitPin { gitDir: string; workTree: string }

/** Identity used for Hydra-authored checkpoint commits inside task worktrees. */
export const HYDRA_IDENTITY = ['-c', 'user.name=Hydra', '-c', 'user.email=hydra@localhost', '-c', 'commit.gpgsign=false']

/**
 * Engine git calls never run repository hooks or fsmonitor helpers: hooks are
 * pointed at an empty, unpredictable, per-process directory. They never start
 * automatic maintenance either, which can prune worktrees outside Hydra's lock.
 */
const NO_HOOKS_DIR = mkdtempSync(join(tmpdir(), 'hydra-nohooks-'))
const SAFE_CONFIG = ['-c', `core.hooksPath=${NO_HOOKS_DIR}`, '-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false', '-c', 'advice.detachedHead=false', '-c', 'maintenance.auto=false']

/** Environment for git: everything except variables that would redirect repository discovery. */
function gitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !/^GIT_/i.test(key)) env[key] = value
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.LC_ALL = 'C'
  return env
}

export async function git(cwd: string, args: string[], options: { allowFail?: boolean; maxBuffer?: number; pin?: GitPin } = {}): Promise<GitResult> {
  const pinned = options.pin ? ['--git-dir', options.pin.gitDir, '--work-tree', options.pin.workTree] : []
  // Read configuration only (Git config does not execute filters). Disable every
  // executable filter with required=true: using one then fails, never silently
  // transforms files or launches repository-configured programs (including LFS).
  const names = await new Promise<string[]>((ok, fail) => execFile('git', [...SAFE_CONFIG, ...pinned, 'config', '--null', '--name-only', '--get-regexp', String.raw`^(filter\..*\.(clean|smudge|process)|merge\..*\.driver)$`],
    { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024, env: gitEnv(process.env) }, (error, stdout) => {
      if (error && (error as { code?: unknown }).code !== 1) { fail(new Error('Could not inspect Git execution configuration safely')); return }
      ok(String(stdout).split('\0').filter(Boolean))
    }))
  if (args.some(arg => ['merge', 'revert', 'cherry-pick'].includes(arg)) && names.some(name => /^merge\./i.test(name))) throw new Error('Hydra refuses configured external Git merge drivers. Use a repository without executable merge drivers; no driver was run.')
  const filters = [...new Set(names.map(name => /^(filter\..*)\.(?:clean|smudge|process)$/i.exec(name)?.[1]).filter((v): v is string => Boolean(v)))]
  const filterPolicy = filters.flatMap(name => ['-c', `${name}.clean=`, '-c', `${name}.smudge=`, '-c', `${name}.process=`, '-c', `${name}.required=true`])
  return new Promise((resolvePromise, reject) => {
    execFile('git', [...SAFE_CONFIG, ...filterPolicy, ...pinned, ...args], {
      cwd, windowsHide: true, maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024, timeout: 120_000, env: gitEnv(process.env)
    }, (error, stdout, stderr) => {
      const raw = (error as { code?: unknown } | null)?.code
      const code = error ? (typeof raw === 'number' ? raw : 1) : 0
      const result = { code, stdout: String(stdout), stderr: String(stderr) }
      if (code !== 0 && !options.allowFail) reject(new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`))
      else resolvePromise(result)
    })
  })
}

export async function isRepository(dir: string): Promise<boolean> {
  const result = await git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })
  return result.code === 0 && result.stdout.trim() === 'true'
}

export async function headSha(dir: string, pin?: GitPin): Promise<string | null> {
  const result = await git(dir, ['rev-parse', '--verify', 'HEAD'], { allowFail: true, pin })
  return result.code === 0 ? result.stdout.trim() : null
}

export async function currentBranch(dir: string, pin?: GitPin): Promise<string | null> {
  const result = await git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFail: true, pin })
  return result.code === 0 ? result.stdout.trim() : null
}

export async function isClean(dir: string, pin?: GitPin): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain', '--untracked-files=normal'], { pin })).stdout.trim() === ''
}

/** True if tracked files differ from HEAD (untracked build output is ignored). */
export async function trackedChanges(dir: string, pin?: GitPin): Promise<boolean> {
  return (await git(dir, ['status', '--porcelain', '--untracked-files=no'], { pin })).stdout.trim() !== ''
}

export async function isAncestor(dir: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await git(dir, ['merge-base', '--is-ancestor', ancestor, descendant], { allowFail: true })).code === 0
}

/** Absolute admin dir of a worktree, read once at creation time when it is trustworthy. */
export async function absoluteGitDir(worktree: string): Promise<string> {
  return resolve((await git(worktree, ['rev-parse', '--absolute-git-dir'])).stdout.trim())
}

/**
 * Confirms the worktree's `.git` pointer still names the admin dir recorded at
 * creation and that HEAD is still the task branch. Anything else means an agent
 * or check tampered with git metadata; the engine refuses to touch it.
 */
export async function assertWorktreeIntact(pin: GitPin, branch: string): Promise<void> {
  let pointer = ''
  try { pointer = readFileSync(join(pin.workTree, '.git'), 'utf8') } catch { /* missing */ }
  const target = /^gitdir:\s*(.+)\s*$/m.exec(pointer)?.[1]
  const same = (a: string, b: string) => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))
  if (!target || !same(resolve(pin.workTree, target), pin.gitDir)) throw new Error('Workspace git metadata was modified (the .git pointer changed). Hydra refuses to operate on it.')
  const head = await currentBranch(pin.workTree, pin)
  if (head !== branch) throw new Error(`Workspace HEAD moved to ${head ?? 'a detached commit'} instead of ${branch}. Hydra refuses to operate on it.`)
}

/** Commits everything under Hydra's identity. Returns the new SHA, or null if nothing changed. */
export async function commitAll(pin: GitPin, message: string, exclude: readonly string[] = []): Promise<string | null> {
  const dir = pin.workTree
  await git(dir, ['add', '-A'], { pin })
  // Paths Hydra linked into the worktree must never be committed: restore their index entries to HEAD.
  for (const path of exclude) await git(dir, ['reset', '-q', '--', path], { allowFail: true, pin })
  const staged = await git(dir, ['diff', '--cached', '--quiet'], { allowFail: true, pin })
  if (staged.code === 0) return null
  await git(dir, [...HYDRA_IDENTITY, 'commit', '--no-verify', '-q', '-m', message], { pin })
  return headSha(dir, pin)
}

/** Parses `git diff base..head` into per-file patches (bounded). */
export async function diffFiles(pin: GitPin, base: string, head: string, maxBytes = 2_000_000): Promise<{ files: DiffFile[]; truncated: boolean }> {
  const dir = pin.workTree
  const numstat = (await git(dir, ['diff', '--numstat', '-M', '-z', base, head], { pin })).stdout
  const status = (await git(dir, ['diff', '--name-status', '-M', '-z', base, head], { pin })).stdout
  const patch = (await git(dir, ['diff', '-M', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', base, head], { maxBuffer: 64 * 1024 * 1024, pin })).stdout

  const stats = new Map<string, { add: number; del: number; binary: boolean }>()
  const numParts = numstat.split('\0')
  for (let i = 0; i < numParts.length; i++) {
    const entry = numParts[i]
    if (!entry) continue
    const [add, del, path] = entry.split('\t')
    if (path === '') { // rename: next two entries are old and new path
      stats.set(numParts[i + 2] ?? '', { add: Number(add) || 0, del: Number(del) || 0, binary: add === '-' })
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

/** The git dir shared by every worktree and subfolder of one repository, or null outside a repository. */
export async function gitCommonDir(dir: string): Promise<string | null> {
  const result = await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { allowFail: true })
  return result.code === 0 && result.stdout.trim() ? resolve(result.stdout.trim()) : null
}

export async function addWorktree(repo: string, path: string, branch: string, base: string): Promise<void> {
  await git(repo, ['worktree', 'add', '-b', branch, path, base])
}

export async function addDetachedWorktree(repo: string, path: string, sha: string): Promise<void> {
  await git(repo, ['worktree', 'add', '--detach', path, sha])
}

export async function removeWorktree(repo: string, path: string): Promise<void> {
  await git(repo, ['worktree', 'remove', '--force', path], { allowFail: true })
  await pruneWorktrees(repo)
}

export async function pruneWorktrees(repo: string): Promise<void> {
  await git(repo, ['worktree', 'prune'], { allowFail: true })
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  if (!branch.startsWith('hydra/')) throw new Error(`Refusing to delete non-Hydra branch ${branch}`)
  await git(repo, ['branch', '-D', branch], { allowFail: true })
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  return (await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true })).code === 0
}

/**
 * Symbolic links added or changed between two commits that can lead outside the
 * repository: absolute targets, or targets that escape when resolved the way the
 * filesystem does it, following every link in the tree component by component
 * (so `alias -> .` plus `leak -> ../alias/../secret` is caught). Unresolvable cases
 * (cycles, too many hops) count as outside.
 */
export async function outsideLinks(repo: string, base: string, head: string): Promise<Array<{ path: string; target: string }>> {
  const slashes = (p: string) => p.split(/[/\\]/).join('/')
  // Every link in the destination tree: a changed link may route through an existing one.
  const tree = (await git(repo, ['ls-tree', '-r', '-z', '--full-tree', head], { allowFail: true })).stdout.split('\0').filter(Boolean)
  const links = new Map<string, string>()
  for (const entry of tree) {
    const tab = entry.indexOf('\t')
    const [mode, , sha] = entry.slice(0, tab).split(' ')
    if (mode === '120000') links.set(slashes(entry.slice(tab + 1)), (await git(repo, ['cat-file', 'blob', sha!], { allowFail: true })).stdout)
  }
  const raw = (await git(repo, ['diff', '--raw', '--no-abbrev', '--no-renames', '-z', base, head], { allowFail: true })).stdout
  const parts = raw.split('\0')
  const found: Array<{ path: string; target: string }> = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]!.trim().split(' ')
    const path = slashes(parts[i + 1]!)
    if (meta[1] !== '120000' || meta[4]?.startsWith('D')) continue
    const target = links.get(path) ?? (await git(repo, ['cat-file', 'blob', meta[3]!], { allowFail: true })).stdout
    if (escapes(path, target, links)) found.push({ path: parts[i + 1]!, target })
  }
  return found
}

/** Resolves a link's target inside the tree, following links like the filesystem; true if it can leave the root. */
export function escapes(linkPath: string, target: string, links: ReadonlyMap<string, string>): boolean {
  const slashes = (p: string) => p.split(/[/\\]/).join('/')
  const isAbsolute = (t: string) => slashes(t).startsWith('/') || /^[A-Za-z]:/.test(t)
  if (isAbsolute(target)) return true
  const resolved: string[] = slashes(linkPath).split('/').slice(0, -1)
  let pending = slashes(target).split('/')
  for (let hops = 0; pending.length; ) {
    const part = pending.shift()!
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!resolved.length) return true
      resolved.pop()
      continue
    }
    resolved.push(part)
    const next = links.get(resolved.join('/'))
    if (next !== undefined) {
      if (++hops > 40 || isAbsolute(next)) return true
      resolved.pop()
      pending = [...slashes(next).split('/'), ...pending]
    }
  }
  return false
}
