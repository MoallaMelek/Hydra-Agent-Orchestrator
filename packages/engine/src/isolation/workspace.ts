import { existsSync, lstatSync, mkdirSync, rmdirSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { AppliedInfo, WorkspaceInfo } from '@hydra/protocol'
import { conflict, invalid } from '../util/errors.js'
import { newId, shortId } from '../util/ids.js'
import { dependencyLinks } from '../verification/detect.js'
import {
  absoluteGitDir, addDetachedWorktree, addWorktree, assertWorktreeIntact, branchExists, commitAll, currentBranch,
  deleteBranch, diffFiles, git, type GitPin, headSha, HYDRA_IDENTITY, isAncestor, isClean, removeWorktree, trackedChanges
} from './git.js'

/** Installed-dependency folders shared from the project into check checkouts; never committed. */
export const LINKED_DEPENDENCIES = ['node_modules'] as const

/**
 * Links the project's installed dependencies into a checkout so checks run offline
 * without re-installing (which would need network access and run install scripts).
 * Only check checkouts get links; agent worktrees never do.
 */
export function linkDependencies(projectRoot: string, checkout: string): string[] {
  const linked: string[] = []
  for (const name of dependencyLinks(projectRoot)) {
    const target = join(checkout, name)
    if (existsSync(target)) continue
    symlinkSync(join(projectRoot, name), target, process.platform === 'win32' ? 'junction' : 'dir')
    linked.push(name)
  }
  return linked
}

/** Removes dependency links (the link only, never the target). */
export function unlinkDependencies(checkout: string): void {
  for (const name of LINKED_DEPENDENCIES) {
    const link = join(checkout, name)
    let info
    try { info = lstatSync(link) } catch { continue }
    if (!info.isSymbolicLink()) continue
    try { unlinkSync(link) } catch { rmdirSync(link) } // rmdir on a junction removes only the junction
  }
}

export const pinOf = (ws: WorkspaceInfo): GitPin => ({ gitDir: ws.gitDir, workTree: ws.path })

export class WorkspaceManager {
  constructor(private readonly worktreesDir: string, private readonly checkoutsDir: string) {
    mkdirSync(worktreesDir, { recursive: true })
    mkdirSync(checkoutsDir, { recursive: true })
  }

  /**
   * Creates (or, after a crash, re-adopts) the task worktree on `hydra/<id>` from the
   * project's current HEAD. The admin dir is recorded now, while it is trustworthy.
   */
  async create(taskId: string, projectRoot: string): Promise<WorkspaceInfo> {
    const path = join(this.worktreesDir, taskId)
    const branch = `hydra/${shortId(taskId)}`
    if (existsSync(path)) {
      if (!(await branchExists(projectRoot, branch))) throw conflict(`An unrelated directory exists at ${path}`)
      const gitDir = await absoluteGitDir(path)
      const pin = { gitDir, workTree: path }
      await assertWorktreeIntact(pin, branch)
      const head = await headSha(path, pin)
      const base = (await git(projectRoot, ['merge-base', 'HEAD', branch])).stdout.trim()
      return { path, gitDir, branch, baseSha: base, headSha: head, removed: false }
    }
    const base = await headSha(projectRoot)
    if (!base) throw invalid('The project has no commits yet. Make an initial commit so Hydra can isolate changes.')
    await addWorktree(projectRoot, path, branch, base)
    return { path, gitDir: await absoluteGitDir(path), branch, baseSha: base, headSha: base, removed: false }
  }

  /** Commits the current worktree state so every stage has an exact SHA. */
  async checkpoint(workspace: WorkspaceInfo, message: string): Promise<WorkspaceInfo> {
    const pin = pinOf(workspace)
    await assertWorktreeIntact(pin, workspace.branch)
    const sha = await commitAll(pin, message, LINKED_DEPENDENCIES)
    return sha ? { ...workspace, headSha: sha } : workspace
  }

  async diff(workspace: WorkspaceInfo) {
    const pin = pinOf(workspace)
    await assertWorktreeIntact(pin, workspace.branch)
    return diffFiles(pin, workspace.baseSha, workspace.headSha ?? workspace.baseSha)
  }

  /**
   * Runs `fn` in a throwaway detached checkout of `sha`, so checks see exactly that
   * commit and cannot alter the task worktree. Reports whether the checks modified
   * tracked files.
   */
  async withCheckout<T>(projectRoot: string, sha: string, fn: (dir: string) => Promise<T>): Promise<{ result: T; mutated: boolean }> {
    const dir = join(this.checkoutsDir, newId())
    await addDetachedWorktree(projectRoot, dir, sha)
    try {
      linkDependencies(projectRoot, dir)
      const result = await fn(dir)
      const mutated = await trackedChanges(dir)
      return { result, mutated }
    } finally {
      unlinkDependencies(dir)
      await removeWorktree(projectRoot, dir)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  /**
   * Brings newer commits from the user's branch into the task branch (inside the
   * worktree) so the result can be re-verified and then fast-forwarded.
   */
  async integrate(workspace: WorkspaceInfo, targetSha: string): Promise<WorkspaceInfo> {
    const pin = pinOf(workspace)
    await assertWorktreeIntact(pin, workspace.branch)
    const merged = await git(workspace.path, [...HYDRA_IDENTITY, 'merge', '--no-ff', '--no-edit', '-m', `hydra: integrate ${targetSha.slice(0, 10)}`, targetSha], { allowFail: true, pin })
    if (merged.code !== 0) {
      await git(workspace.path, ['merge', '--abort'], { allowFail: true, pin })
      throw conflict('Your branch has changes that conflict with this task. Nothing was applied; the task branch is unchanged.')
    }
    return { ...workspace, headSha: await headSha(workspace.path, pin) }
  }

  /** Reads the user's branch state and validates it is safe to apply onto. */
  async target(projectRoot: string): Promise<{ branch: string; head: string }> {
    const branch = await currentBranch(projectRoot)
    if (!branch) throw conflict('The project is in a detached HEAD state; check out a branch before accepting.')
    if (branch.startsWith('hydra/')) throw conflict('A Hydra task branch is checked out; switch back to your branch first.')
    if (!(await isClean(projectRoot))) throw conflict('Your working tree has uncommitted changes. Commit or stash them, then accept again. Hydra never overwrites uncommitted work.')
    const head = await headSha(projectRoot)
    if (!head) throw conflict('Project has no HEAD')
    return { branch, head }
  }

  /** Fast-forwards the user's branch to the approved, verified SHA. Nothing else is ever written to it. */
  async apply(projectRoot: string, approvedSha: string, integratedSha: string | null): Promise<AppliedInfo> {
    const { branch, head } = await this.target(projectRoot)
    if (await isAncestor(projectRoot, approvedSha, head)) {
      return { targetBranch: branch, beforeSha: head, afterSha: head, method: 'none', integratedSha, rolledBackSha: null }
    }
    if (!(await isAncestor(projectRoot, head, approvedSha))) throw conflict('Your branch moved after the task was verified. Accept again so Hydra can integrate and re-verify.')
    await git(projectRoot, ['merge', '--ff-only', approvedSha])
    return { targetBranch: branch, beforeSha: head, afterSha: (await headSha(projectRoot))!, method: 'fast_forward', integratedSha, rolledBackSha: null }
  }

  /** Undoes an applied task with one new revert commit. History is never rewritten. */
  async rollback(projectRoot: string, applied: AppliedInfo, label: string): Promise<string> {
    if (applied.rolledBackSha) throw conflict('This task was already rolled back')
    if (applied.method === 'none') throw conflict('Nothing was applied, so there is nothing to roll back')
    const branch = await currentBranch(projectRoot)
    if (branch !== applied.targetBranch) throw conflict(`Check out ${applied.targetBranch} to roll back this task.`)
    if (!(await isClean(projectRoot))) throw conflict('Your working tree has uncommitted changes; commit or stash them before rolling back.')
    const reverted = await git(projectRoot, ['revert', '--no-commit', '--no-edit', `${applied.beforeSha}..${applied.afterSha}`], { allowFail: true })
    if (reverted.code !== 0) {
      await git(projectRoot, ['revert', '--abort'], { allowFail: true })
      throw conflict('Later commits conflict with the rollback. Nothing was changed; revert manually if needed.')
    }
    const identity = (await git(projectRoot, ['config', 'user.email'], { allowFail: true })).stdout.trim() ? [] : HYDRA_IDENTITY
    const committed = await git(projectRoot, [...identity, 'commit', '--no-verify', '-q', '-m', `Hydra: roll back ${label}`], { allowFail: true })
    if (committed.code !== 0) {
      await git(projectRoot, ['revert', '--abort'], { allowFail: true })
      throw conflict(`Rollback commit failed and was undone: ${committed.stderr.trim().slice(0, 300)}`)
    }
    return (await headSha(projectRoot))!
  }

  async discard(projectRoot: string, workspace: WorkspaceInfo): Promise<WorkspaceInfo> {
    unlinkDependencies(workspace.path)
    await removeWorktree(projectRoot, workspace.path)
    await deleteBranch(projectRoot, workspace.branch)
    return { ...workspace, removed: true }
  }

  /** Release the worktree directory but keep the branch for the user. */
  async release(projectRoot: string, workspace: WorkspaceInfo): Promise<WorkspaceInfo> {
    unlinkDependencies(workspace.path)
    await removeWorktree(projectRoot, workspace.path)
    return { ...workspace, removed: true }
  }
}
