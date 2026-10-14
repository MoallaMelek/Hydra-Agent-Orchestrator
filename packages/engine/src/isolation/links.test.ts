import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { escapes, outsideLinks } from './git.js'
import { linkDependencies, WorkspaceManager } from './workspace.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, makeRepo, tempDir } from '../testing/fixtures.js'

// Real git. Links are committed with plumbing so the test also runs on Windows without
// symlink privileges (git records mode 120000 either way).

const dirs: string[] = []
afterEach(() => cleanup(...dirs.splice(0)))

function commitWithLinks(repo: string, links: Record<string, string>): string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  for (const [path, target] of Object.entries(links)) {
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: target, encoding: 'utf8' }).trim()
    git('update-index', '--add', '--cacheinfo', `120000,${blob},${path}`)
  }
  const tree = git('write-tree')
  const parent = git('rev-parse', 'HEAD')
  git('read-tree', 'HEAD') // leave the user's index as it was
  return execFileSync('git', ['commit-tree', tree, '-p', parent, '-m', 'links'], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } }).trim()
}

describe('links that point outside the project', () => {
  it('flags absolute and escaping links, not links inside the project', async () => {
    const repo = makeRepo({ 'a.txt': 'a', 'docs/readme.md': 'r' })
    dirs.push(repo)
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    const head = commitWithLinks(repo, {
      'inside': 'docs/readme.md',
      'docs/up-but-inside': '../a.txt',
      'ssh': '/home/user/.ssh',
      'win': 'C:\\Users\\me\\.ssh',
      'docs/escape': '../../outside'
    })
    const found = (await outsideLinks(repo, base, head)).map((l) => l.path).sort()
    expect(found).toEqual(['docs/escape', 'ssh', 'win'])
  })

  it('refuses to apply a change that adds such a link', async () => {
    const repo = makeRepo({ 'a.txt': 'a' })
    const data = tempDir('hydra-links-')
    dirs.push(repo, data)
    const head = commitWithLinks(repo, { 'keys': '/etc/ssh' })
    const manager = new WorkspaceManager(`${data}/w`, `${data}/c`)
    await expect(manager.apply(repo, head, null)).rejects.toThrow(/link to a location outside your project/)
    // The user's branch did not move.
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()).not.toBe(head)
  })
})

describe('cleanup after a crash', () => {
  it('removes leftover check copies without following their links into the project', async () => {
    const repo = makeRepo({ 'a.txt': 'a' })
    const data = tempDir('hydra-sweep-')
    dirs.push(repo, data)
    // The project's installed dependencies, which check copies link to.
    mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(repo, 'node_modules', 'pkg', 'index.js'), 'precious')
    const manager = new WorkspaceManager(join(data, 'w'), join(data, 'c'))
    // Simulate a crash in the middle of a check: the copy and its link are left behind.
    const leftover = join(data, 'c', 'crashed')
    mkdirSync(leftover, { recursive: true })
    linkDependencies(repo, leftover)
    expect(existsSync(join(leftover, 'node_modules', 'pkg', 'index.js'))).toBe(true)
    expect(await manager.sweepLeftovers([repo])).toBe(1)
    expect(existsSync(leftover)).toBe(false)
    expect(readFileSync(join(repo, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('precious')
  })
})

describe('links resolved like the filesystem (independent review A5-3)', () => {
  it('catches an escape that goes through another link', async () => {
    const repo = makeRepo({ 'a.txt': 'a', 'docs/readme.md': 'r' })
    dirs.push(repo)
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
    // alias -> . ; docs/leak -> ../alias/../secret  reaches the repository's parent.
    const head = commitWithLinks(repo, { 'alias': '.', 'docs/leak': '../alias/../secret' })
    expect((await outsideLinks(repo, base, head)).map((l) => l.path)).toEqual(['docs/leak'])
  })

  it('resolution rules: chains, cycles and links that stay inside', () => {
    const links = new Map([['alias', '.'], ['up', '..'], ['loop1', 'loop2'], ['loop2', 'loop1'], ['docs/inner', '../a.txt']])
    expect(escapes('docs/leak', '../alias/../secret', links)).toBe(true)
    expect(escapes('x', 'up/etc', links)).toBe(true)
    expect(escapes('x', 'loop1/file', links)).toBe(true) // never resolves: treated as outside
    expect(escapes('docs/ok', 'inner', links)).toBe(false)
    expect(escapes('docs/ok', '../alias/docs/readme.md', links)).toBe(false)
  })
})
