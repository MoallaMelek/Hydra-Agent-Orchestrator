import { existsSync, lstatSync, mkdirSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { AppliedInfo, WorkspaceInfo } from '@hydra/protocol'
import { dependencyLinks } from '../verification/detect.js'
import { conflict, invalid } from '../util/errors.js'
import { shortId } from '../util/ids.js'
import {
  addWorktree, commitAll, currentBranch, deleteBranch, diffFiles, git, headSha, HYDRA_IDENTITY, isClean, removeWorktree
} from './git.js'

/** Installed-dependency folders shared from the project into worktrees; excluded from every commit. */
export const LINKED_DEPENDENCIES = ['node_modules'] as const

/**
 * Links the project's installed dependencies into a worktree so checks can run
 * offline without re-installing (which would need network and run install scripts).
 * Directory junctions on Windows need no elevation.
 */
export function linkDependencies(projectRoot: string, worktree: string): string[] {
  const linked: string[] = []
  for (const name of dependencyLinks(projectRoot)) {
    const target = join(worktree, name)
    if (existsSync(target)) continue
    symlinkSync(join(projectRoot, name), target, process.platform === 'win32' ? 'junction' : 'dir')
    linked.push(name)
  }
  return linked
}

/** Removes dependency links (the link only, never the target) before a worktree is deleted. */
export function unlinkDependencies(worktree: string): void {
  for (const name of LINKED_DEPENDENCIES) {
    const link = join(worktree, name)
    let info
    try { info = lstatSync(link) } catch { continue }
    if (!info.isSymbolicLink()) continue // a real directory created by an agent: leave it to git
    try { unlinkSync(link) } catch { rmdirSync(link) } // rmdir on a junction removes only the junction
  }
}

export class WorkspaceManager {
  constructor(private readonly worktreesDir: string) {
    mkdirSync(worktreesDir, { recursive: true })
  }

  /** Creates an isolated worktree on a new `hydra/<id>` branch from the project's current HEAD. */
  async create(taskId: string, projectRoot: string): Promise<WorkspaceInfo> {
    const base = await headSha(projectRoot)
    if (!base) throw invalid('The project has no commits yet. Make an initial commit so Hydra can isolate changes.')
    const path = join(this.worktreesDir, taskId)
    const branch = `hydra/${shortId(taskId)}`
    if (existsSync(path)) throw conflict(`Workspace already exists at ${path}`)
    await addWorktree(projectRoot, path, branch, base)
    linkDependencies(projectRoot, path)
    return { path, branch, baseSha: base, headSha: base, removed: false }
  }

  /** Commits the current worktree state so every stage has an exact SHA. */
  async checkpoint(workspace: WorkspaceInfo, message: string): Promise<WorkspaceInfo> {
    const sha = await commitAll(workspace.path, message, LINKED_DEPENDENCIES)
    return sha ? { ...workspace, headSha: sha } : workspace
  }

  diff(workspace: WorkspaceInfo) {
    return diffFiles(workspace.path, workspace.baseSha, workspace.headSha ?? workspace.baseSha)
  }

  /**
   * Applies the approved SHA to the user's current branch. Never touches a dirty
   * tree, never force-updates, aborts cleanly on conflict.
   */
  async apply(projectRoot: string, workspace: WorkspaceInfo, approvedSha: string, label: string): Promise<AppliedInfo> {
    const target = await currentBranch(projectRoot)
    if (!target) throw conflict('The project is in a detached HEAD state; check out a branch before accepting.')
    if (target.startsWith('hydra/')) throw conflict('The project has a Hydra task branch checked out; switch back to your branch first.')
    if (!(await isClean(projectRoot))) throw conflict('Your working tree has uncommitted changes. Commit or stash them, then accept again. Hydra never overwrites uncommitted work.')
    const before = await headSha(projectRoot)
    if (!before) throw conflict('Project has no HEAD')
    const identity = await this.identityArgs(projectRoot)
    if (before === workspace.baseSha) {
      await git(projectRoot, ['merge', '--ff-only', approvedSha])
      return { targetBranch: target, beforeSha: before, afterSha: (await headSha(projectRoot))!, method: 'fast_forward', rolledBackSha: null }
    }
    const merged = await git(projectRoot, [...identity, 'merge', '--no-ff', '--no-edit', '-m', `Hydra: apply ${label}`, approvedSha], { allowFail: true })
    if (merged.code !== 0) {
      await git(projectRoot, ['merge', '--abort'], { allowFail: true })
      throw conflict(`Your branch changed since the task started and the changes conflict. Nothing was applied; the task branch ${workspace.branch} is kept for a manual merge.`)
    }
    return { targetBranch: target, beforeSha: before, afterSha: (await headSha(projectRoot))!, method: 'merge', rolledBackSha: null }
  }

  /** Undoes an applied task with new revert commit(s). History is never rewritten. */
  async rollback(projectRoot: string, applied: AppliedInfo, label: string): Promise<string> {
    if (applied.rolledBackSha) throw conflict('This task was already rolled back')
    const branch = await currentBranch(projectRoot)
    if (branch !== applied.targetBranch) throw conflict(`Check out ${applied.targetBranch} to roll back this task.`)
    if (!(await isClean(projectRoot))) throw conflict('Your working tree has uncommitted changes; commit or stash them before rolling back.')
    const identity = await this.identityArgs(projectRoot)
    const args = applied.method === 'merge'
      ? ['revert', '--no-commit', '-m', '1', applied.afterSha]
      : ['revert', '--no-commit', `${applied.beforeSha}..${applied.afterSha}`]
    const reverted = await git(projectRoot, args, { allowFail: true })
    if (reverted.code !== 0) {
      await git(projectRoot, ['revert', '--abort'], { allowFail: true })
      throw conflict('Later commits conflict with the rollback. Nothing was changed; revert manually if needed.')
    }
    await git(projectRoot, [...identity, 'commit', '--no-verify', '-q', '-m', `Hydra: roll back ${label}`])
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

  /** Uses the repository's own identity when configured, Hydra's otherwise. */
  private async identityArgs(projectRoot: string): Promise<string[]> {
    const email = await git(projectRoot, ['config', 'user.email'], { allowFail: true })
    return email.code === 0 && email.stdout.trim() ? [] : HYDRA_IDENTITY
  }
}
