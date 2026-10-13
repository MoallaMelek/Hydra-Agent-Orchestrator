import { chmodSync, closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, gitIn, makeRepo, tempDir, writeFiles } from '../testing/fixtures.js'
import { WorkspaceManager } from './workspace.js'
import { validateProjectRoot } from './roots.js'

const dirs: string[] = []
afterEach(() => cleanup(...dirs.splice(0)))

function setup(files: Record<string, string> = { 'a.txt': 'one\n' }) {
  const repo = makeRepo(files)
  const data = tempDir('hydra-data-')
  dirs.push(repo, data)
  return { repo, data, manager: new WorkspaceManager(join(data, 'worktrees'), join(data, 'checkouts')) }
}
let seq = 0
const id = () => `01testtaskid0000000000${String(++seq).padStart(4, '0')}`

describe('workspace isolation', () => {
  it('keeps agent edits out of the user tree until apply, then rolls back with a revert', async () => {
    const { repo, manager } = setup()
    let ws = await manager.create(id(), repo)
    writeFileSync(join(ws.path, 'a.txt'), 'two\n')
    ws = await manager.checkpoint(ws, 'hydra: implement')
    expect(ws.headSha).not.toBe(ws.baseSha)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\n')

    const applied = await manager.apply(repo, ws.headSha!, null)
    expect(applied.method).toBe('fast_forward')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('two\n')

    const revert = await manager.rollback(repo, applied, 'test')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\n')
    expect(gitIn(repo, 'rev-parse', 'HEAD')).toBe(revert)
    expect(gitIn(repo, 'log', '--oneline').split('\n')).toHaveLength(3)
  })

  it('refuses to apply over uncommitted user work', async () => {
    const { repo, manager } = setup()
    let ws = await manager.create(id(), repo)
    writeFileSync(join(ws.path, 'a.txt'), 'agent\n')
    ws = await manager.checkpoint(ws, 'x')
    writeFileSync(join(repo, 'a.txt'), 'my unsaved work\n')
    await expect(manager.apply(repo, ws.headSha!, null)).rejects.toThrow(/uncommitted/)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('my unsaved work\n')
  })

  it('never merges into the user branch: a moved branch must be integrated in the worktree first', async () => {
    const { repo, manager } = setup({ 'a.txt': 'one\n', 'b.txt': 'b\n' })
    let ws = await manager.create(id(), repo)
    writeFileSync(join(ws.path, 'a.txt'), 'agent\n')
    ws = await manager.checkpoint(ws, 'x')
    writeFiles(repo, { 'b.txt': 'user change\n' })
    gitIn(repo, 'commit', '-qam', 'user')
    const userHead = gitIn(repo, 'rev-parse', 'HEAD')
    await expect(manager.apply(repo, ws.headSha!, null)).rejects.toThrow(/moved/)
    expect(gitIn(repo, 'rev-parse', 'HEAD')).toBe(userHead)

    ws = await manager.integrate(ws, userHead)
    expect(readFileSync(join(ws.path, 'b.txt'), 'utf8')).toBe('user change\n')
    const applied = await manager.apply(repo, ws.headSha!, ws.headSha)
    expect(applied.method).toBe('fast_forward')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('agent\n')
  })

  it('aborts integration cleanly on conflict and reports nothing to apply when already present', async () => {
    const { repo, manager } = setup({ 'b.txt': 'b\n' })
    let ws = await manager.create(id(), repo)
    writeFileSync(join(ws.path, 'b.txt'), 'agent b\n')
    ws = await manager.checkpoint(ws, 'y')
    writeFiles(repo, { 'b.txt': 'conflicting user b\n' })
    gitIn(repo, 'commit', '-qam', 'user 2')
    const head = gitIn(repo, 'rev-parse', 'HEAD')
    await expect(manager.integrate(ws, head)).rejects.toThrow(/conflict/)
    expect(gitIn(ws.path, 'status', '--porcelain')).toBe('')
    const noop = await manager.apply(repo, gitIn(repo, 'rev-parse', 'HEAD~1'), null)
    expect(noop.method).toBe('none')
    await expect(manager.rollback(repo, noop, 'x')).rejects.toThrow(/Nothing was applied/)
  })

  it('detects a tampered .git pointer and refuses to commit through it', async () => {
    const { repo, manager } = setup()
    const ws = await manager.create(id(), repo)
    // Try to redirect the worktree to the user's repo (r+ also works on Windows, where git hides the file).
    const fd = openSync(join(ws.path, '.git'), 'r+')
    ftruncateSync(fd, 0)
    writeSync(fd, `gitdir: ${join(repo, '.git')}\n`)
    closeSync(fd)
    writeFileSync(join(ws.path, 'a.txt'), 'evil\n')
    await expect(manager.checkpoint(ws, 'x')).rejects.toThrow(/git metadata was modified/)
    expect(gitIn(repo, 'log', '--oneline').split('\n')).toHaveLength(1)
    expect(gitIn(repo, 'status', '--porcelain')).toBe('')
  })

  it('does not run repository hooks during engine git operations', async () => {
    const { repo, manager } = setup()
    const marker = join(repo, '..', `hook-ran-${seq}`)
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
    for (const hook of ['post-checkout', 'post-commit', 'pre-commit', 'post-merge']) {
      const path = join(repo, '.git', 'hooks', hook)
      writeFileSync(path, `#!/bin/sh\necho ran > "${marker.replaceAll('\\', '/')}"\n`)
      try { chmodSync(path, 0o755) } catch { /* windows */ }
    }
    let ws = await manager.create(id(), repo)
    writeFileSync(join(ws.path, 'a.txt'), 'x\n')
    ws = await manager.checkpoint(ws, 'x')
    await manager.apply(repo, ws.headSha!, null)
    expect(existsSync(marker)).toBe(false)
  })

  it('agent worktrees never get dependency links; check checkouts do, and removing them keeps the project intact', async () => {
    const { repo, manager } = setup({ '.gitignore': 'node_modules/\n', 'x.txt': 'x' })
    mkdirSync(join(repo, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'module.exports = 1')
    const ws = await manager.create(id(), repo)
    expect(existsSync(join(ws.path, 'node_modules'))).toBe(false)
    const { result, mutated } = await manager.withCheckout(repo, ws.baseSha, async (dir) => existsSync(join(dir, 'node_modules', 'dep', 'index.js')))
    expect(result).toBe(true)
    expect(mutated).toBe(false)
    await manager.discard(repo, ws)
    expect(readFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('module.exports = 1')
    expect(gitIn(repo, 'branch', '--list', 'hydra/*')).toBe('')
    expect(gitIn(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  it('reports when a check modifies tracked files in its checkout', async () => {
    const { repo, manager } = setup()
    const { mutated } = await manager.withCheckout(repo, gitIn(repo, 'rev-parse', 'HEAD'), async (dir) => { writeFileSync(join(dir, 'a.txt'), 'changed by test\n') })
    expect(mutated).toBe(true)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\n')
  })

  it('re-adopts its own worktree after a crash instead of failing', async () => {
    const { repo, manager } = setup()
    const taskId = id()
    const first = await manager.create(taskId, repo)
    const again = await manager.create(taskId, repo)
    expect(again.path).toBe(first.path)
    expect(again.baseSha).toBe(first.baseSha)
  })

  it('refuses dangerous project roots', () => {
    const data = tempDir('hydra-data-')
    dirs.push(data)
    expect(() => validateProjectRoot(homedir(), data)).toThrow(/home directory/)
    expect(() => validateProjectRoot(process.platform === 'win32' ? 'C:\\' : '/', data)).toThrow(/root|System/)
    expect(() => validateProjectRoot('relative/path', data)).toThrow(/absolute/)
    expect(() => validateProjectRoot(data, data)).toThrow(/data directory/)
  })
})
