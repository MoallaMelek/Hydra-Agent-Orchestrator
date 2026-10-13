import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export function tempDir(prefix = 'hydra-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Creates a git repository with the given files committed on branch `main`. */
export function makeRepo(files: Record<string, string>): string {
  const root = tempDir('hydra-repo-')
  gitIn(root, 'init', '-q', '-b', 'main')
  gitIn(root, 'config', 'user.name', 'Test User')
  gitIn(root, 'config', 'user.email', 'test@example.invalid')
  gitIn(root, 'config', 'commit.gpgsign', 'false')
  gitIn(root, 'config', 'core.autocrlf', 'false')
  writeFiles(root, files)
  gitIn(root, 'add', '-A')
  gitIn(root, 'commit', '-q', '-m', 'initial')
  return root
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* best effort on Windows */ }
  }
}

/** A tiny Node project whose `npm test` fails until add() is fixed. */
export const BUGGY_NODE_PROJECT = {
  'package.json': JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node --test' } }, null, 2),
  'math.js': 'function add(a, b) {\n  return a - b\n}\nmodule.exports = { add }\n',
  'math.test.js': 'const { test } = require("node:test")\nconst assert = require("node:assert/strict")\nconst { add } = require("./math.js")\ntest("add", () => { assert.equal(add(2, 3), 5) })\n',
  '.gitignore': 'node_modules/\n'
}

export const FIXED_MATH = 'function add(a, b) {\n  return a + b\n}\nmodule.exports = { add }\n'
