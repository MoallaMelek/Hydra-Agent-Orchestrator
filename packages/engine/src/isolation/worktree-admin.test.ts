import { mkdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, gitIn, makeRepo, tempDir } from '../testing/fixtures.js'
import type * as Git from './git.js'
import { WorkspaceManager } from './workspace.js'

/**
 * Counts git worktree bookkeeping commands (add, remove, prune, branch -D) in flight at once.
 * Real git still runs underneath; the count turns a timing-dependent git failure into a
 * deterministic check of the invariant that prevents it.
 */
const admin = vi.hoisted(() => ({ active: 0, peak: 0 }))
vi.mock('./git.js', async (importOriginal) => {
  const real = await importOriginal<typeof Git>()
  const counted = <A extends unknown[]>(fn: (...args: A) => Promise<void>) => async (...args: A) => {
    admin.peak = Math.max(admin.peak, ++admin.active)
    try { return await fn(...args) } finally { admin.active-- }
  }
  return {
    ...real,
    addWorktree: counted(real.addWorktree),
    addDetachedWorktree: counted(real.addDetachedWorktree),
    removeWorktree: counted(real.removeWorktree),
    deleteBranch: counted(real.deleteBranch),
    pruneWorktrees: counted(real.pruneWorktrees)
  }
})

const dirs: string[] = []
afterEach(() => cleanup(...dirs.splice(0)))

function setup() {
  const repo = makeRepo({ 'a.txt': 'one\n', 'sub/b.txt': 'b\n' })
  const data = tempDir('hydra-data-')
  dirs.push(repo, data)
  admin.active = 0
  admin.peak = 0
  return { repo, data, head: gitIn(repo, 'rev-parse', 'HEAD'), manager: new WorkspaceManager(join(data, 'worktrees'), join(data, 'checkouts')) }
}
let seq = 0
const id = () => `01adminlocktask00000000${String(++seq).padStart(3, '0')}`

describe('git worktree bookkeeping on one repository', () => {
  it('serializes concurrent worktree creation and removal, so git never reads a half-written entry', async () => {
    const { repo, head, manager } = setup()
    // The user's own linked checkout of the same repository, opened as a separate project.
    const linked = tempDir('hydra-linked-')
    dirs.push(linked)
    gitIn(repo, 'worktree', 'add', '-q', '-b', 'user-checkout', linked)
    // One repository reached through different spellings, a subfolder project and a linked checkout: all share one lock.
    const roots = [repo, `${repo}${sep}`, repo.replaceAll('\\', '/'), process.platform === 'win32' ? repo.toUpperCase() : repo, join(repo, 'sub'), linked]
    const root = (i: number) => roots[i % roots.length]!
    const check = (i: number) => manager.withCheckout(root(i), head, async (dir) => readFileSync(join(dir, 'a.txt'), 'utf8'))
    const task = async (i: number) => {
      const ws = await manager.create(id(), root(i))
      await manager.discard(root(i), ws)
    }
    // Without the lock, git intermittently dies here with "failed to read .git/worktrees/<id>/commondir"
    // or leaves a hydra/* branch behind; the peak count below fails every time.
    for (let round = 0; round < 2; round++) {
      const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => (i % 2 ? check(i) : task(i))))
      expect(results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []))).toEqual([])
      expect(gitIn(repo, 'branch', '--list', 'hydra/*')).toBe('')
    }
    expect(admin.peak).toBe(1)
    expect(gitIn(repo, 'worktree', 'list').split('\n')).toHaveLength(2) // the repository and the user's linked checkout
  }, 150_000)

  it('puts release and the crash-leftover sweep under the same lock', async () => {
    const { repo, data, manager } = setup()
    mkdirSync(join(data, 'checkouts', 'left-behind-by-a-crash'))
    const keep = async () => manager.release(repo, await manager.create(id(), repo))
    const results = await Promise.allSettled([...Array.from({ length: 6 }, keep), manager.sweepLeftovers([repo]), keep()])
    expect(results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []))).toEqual([])
    expect(admin.peak).toBe(1)
    expect(gitIn(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
    expect(gitIn(repo, 'branch', '--list', 'hydra/*').split('\n')).toHaveLength(7) // release keeps each branch for the user
  }, 60_000)

  it('keeps the checks themselves parallel: only the bookkeeping waits', async () => {
    const { repo, head, manager } = setup()
    let inside = 0
    let bothInside!: () => void
    const barrier = new Promise<void>((resolve) => { bothInside = resolve })
    const check = () => manager.withCheckout(repo, head, async () => {
      if (++inside === 2) bothInside()
      // Each check waits until the other is running too; checks run one at a time would time out here.
      await Promise.race([barrier, new Promise((_, reject) => setTimeout(() => reject(new Error('checks ran one at a time')), 30_000))])
    })
    await Promise.all([check(), check()])
    expect(inside).toBe(2)
  })

})
