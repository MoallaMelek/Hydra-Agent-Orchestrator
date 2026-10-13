import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, gitIn, makeRepo, tempDir, writeFiles } from '../testing/fixtures.js'
import { WorkspaceManager } from './workspace.js'
import { validateProjectRoot } from './roots.js'
import { homedir } from 'node:os'

const dirs: string[] = []
afterEach(() => cleanup(...dirs.splice(0)))

function setup(files: Record<string, string> = { 'a.txt': 'one\n' }) {
  const repo = makeRepo(files)
  const data = tempDir('hydra-data-')
  dirs.push(repo, data)
  return { repo, data, manager: new WorkspaceManager(join(data, 'worktrees')) }
}

describe('workspace isolation', () => {
  it('keeps agent edits out of the user tree until apply', async () => {
    const { repo, manager } = setup()
    let ws = await manager.create('01testtaskid0000000000aaaa', repo)
    writeFileSync(join(ws.path, 'a.txt'), 'two\n')
    ws = await manager.checkpoint(ws, 'hydra: implement')
    expect(ws.headSha).not.toBe(ws.baseSha)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\n')

    const applied = await manager.apply(repo, ws, ws.headSha!, 'test')
    expect(applied.method).toBe('fast_forward')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('two\n')

    const revert = await manager.rollback(repo, applied, 'test')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\n')
    expect(gitIn(repo, 'rev-parse', 'HEAD')).toBe(revert)
    expect(gitIn(repo, 'log', '--oneline').split('\n')).toHaveLength(3) // history preserved, nothing rewritten
  })

  it('refuses to apply over uncommitted user work', async () => {
    const { repo, manager } = setup()
    let ws = await manager.create('01testtaskid0000000000bbbb', repo)
    writeFileSync(join(ws.path, 'a.txt'), 'agent\n')
    ws = await manager.checkpoint(ws, 'x')
    writeFileSync(join(repo, 'a.txt'), 'my unsaved work\n')
    await expect(manager.apply(repo, ws, ws.headSha!, 't')).rejects.toThrow(/uncommitted/)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('my unsaved work\n')
  })

  it('merges when the user committed meanwhile, and aborts cleanly on conflict', async () => {
    const { repo, manager } = setup({ 'a.txt': 'one\n', 'b.txt': 'b\n' })
    let ws = await manager.create('01testtaskid0000000000cccc', repo)
    writeFileSync(join(ws.path, 'a.txt'), 'agent\n')
    ws = await manager.checkpoint(ws, 'x')
    writeFiles(repo, { 'b.txt': 'user change\n' })
    gitIn(repo, 'commit', '-qam', 'user')
    const applied = await manager.apply(repo, ws, ws.headSha!, 't')
    expect(applied.method).toBe('merge')
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('agent\n')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('user change\n')

    let ws2 = await manager.create('01testtaskid0000000000dddd', repo)
    writeFileSync(join(ws2.path, 'b.txt'), 'agent b\n')
    ws2 = await manager.checkpoint(ws2, 'y')
    writeFiles(repo, { 'b.txt': 'conflicting user b\n' })
    gitIn(repo, 'commit', '-qam', 'user 2')
    const before = gitIn(repo, 'rev-parse', 'HEAD')
    await expect(manager.apply(repo, ws2, ws2.headSha!, 't')).rejects.toThrow(/conflict/)
    expect(gitIn(repo, 'rev-parse', 'HEAD')).toBe(before)
    expect(gitIn(repo, 'status', '--porcelain')).toBe('')
  })

  it('discarding never deletes the project dependencies linked into the worktree', async () => {
    const { repo, manager } = setup({ '.gitignore': 'node_modules/\n', 'x.txt': 'x' })
    mkdirSync(join(repo, 'node_modules', 'dep'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'module.exports = 1')
    let ws = await manager.create('01testtaskid0000000000eeee', repo)
    expect(existsSync(join(ws.path, 'node_modules', 'dep', 'index.js'))).toBe(true)
    writeFileSync(join(ws.path, 'x.txt'), 'y')
    ws = await manager.checkpoint(ws, 'z')
    expect(gitIn(ws.path, 'show', '--name-only', '--format=', 'HEAD')).toBe('x.txt') // link never committed
    await manager.discard(repo, ws)
    expect(existsSync(ws.path)).toBe(false)
    expect(readFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('module.exports = 1')
    expect(gitIn(repo, 'branch', '--list', 'hydra/*')).toBe('')
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
