import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CheckSpec } from '@hydra/protocol'
import { BUGGY_NODE_PROJECT, cleanup, makeRepo, tempDir } from '../testing/fixtures.js'
import { detectChecks } from './detect.js'
import { passed, runChecks } from './runner.js'

const dirs: string[] = []
afterEach(() => cleanup(...dirs.splice(0)))
const repo = (files: Record<string, string>) => { const r = makeRepo(files); dirs.push(r); return r }
const labels = (root: string) => detectChecks(root).map((c) => c.label)

describe('check detection across ecosystems', () => {
  it('node: uses the lockfile package manager and skips npm placeholder tests', () => {
    expect(labels(repo({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc' } }) }))).toEqual(['npm run typecheck', 'npm run lint', 'npm run test'])
    expect(labels(repo({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }), 'pnpm-lock.yaml': '' }))).toEqual(['pnpm run test'])
    expect(labels(repo({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }))).toEqual([])
  })
  it('python: pytest when configured, unittest otherwise', () => {
    expect(labels(repo({ 'pyproject.toml': '[tool.pytest.ini_options]\n', 'test_x.py': '' }))).toEqual(['pytest'])
    expect(labels(repo({ 'test_x.py': 'import unittest' }))).toEqual(['unittest'])
  })
  it('go, rust, java, c++', () => {
    expect(labels(repo({ 'go.mod': 'module x' }))).toEqual(['go build', 'go vet', 'go test'])
    expect(labels(repo({ 'Cargo.toml': '[package]' }))).toEqual(['cargo build', 'cargo test'])
    expect(labels(repo({ 'pom.xml': '<project/>' }))).toEqual(['maven test'])
    expect(labels(repo({ 'build.gradle.kts': '' }))).toEqual(['gradle test'])
    expect(labels(repo({ 'CMakeLists.txt': 'project(x)' }))).toEqual(['cmake configure', 'cmake build', 'ctest'])
    expect(labels(repo({ Makefile: 'test:\n\techo ok\n' }))).toEqual(['make test'])
  })
  it('project-declared checks replace detection and are validated', () => {
    const r = repo({ '.hydra/checks.json': JSON.stringify({ checks: [{ label: 'smoke', kind: 'test', argv: ['node', '-e', '0'] }] }), 'go.mod': '' })
    expect(labels(r)).toEqual(['smoke'])
    const bad = repo({ '.hydra/checks.json': JSON.stringify({ checks: [{ label: 'x', kind: 'nope', argv: [] }] }) })
    expect(() => detectChecks(bad)).toThrow()
  })
})

describe('check runner records observed evidence', () => {
  const spec = (argv: string[], over: Partial<CheckSpec> = {}): CheckSpec => ({ id: 'c', ecosystem: 'custom', kind: 'test', label: 'c', argv, cwd: '.', timeoutSec: 30, required: true, ...over })
  const opts = (root: string) => {
    const data = tempDir('hydra-ev-')
    dirs.push(data)
    return { taskId: 't', workspacePath: root, commitSha: 'a'.repeat(40), phase: 'verify' as const, logsDir: join(data, 'logs'), scratchDir: join(data, 'scratch'), signal: new AbortController().signal }
  }

  it('captures real exit codes from a failing and a fixed project', async () => {
    const root = repo(BUGGY_NODE_PROJECT)
    const [failing] = await runChecks(detectChecks(root), opts(root))
    expect(failing!.exitCode).not.toBe(0)
    expect(passed(failing!)).toBe(false)
    expect(failing!.outputSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('distinguishes pass, missing tool and timeout', async () => {
    const root = repo({ 'x.txt': '' })
    const o = opts(root)
    const [ok, missing, slow] = await runChecks([
      spec([process.execPath, '-e', 'console.log("hello")'], { id: 'ok' }),
      spec(['definitely-not-a-real-tool-hydra'], { id: 'missing' }),
      spec([process.execPath, '-e', 'setTimeout(()=>{}, 60000)'], { id: 'slow', timeoutSec: 1 })
    ], o)
    expect(passed(ok!)).toBe(true)
    expect(ok!.outputTail).toContain('hello')
    expect(readFileSync(join(o.logsDir, `${ok!.id}.log`), 'utf8')).toContain('hello')
    expect(missing!.spawnError).toMatch(/not installed/)
    expect(slow!.timedOut).toBe(true)
    expect(slow!.exitCode).toBeNull()
  })

  it('does not leak secrets from the environment into checks', async () => {
    const root = repo({ 'x.txt': '' })
    const [result] = await runChecks([spec([process.execPath, '-e', 'console.log(JSON.stringify(process.env))'])], {
      ...opts(root), env: { ...process.env, GITHUB_TOKEN: 'ghp_secret_value', AWS_SECRET_ACCESS_KEY: 'aws_secret', NODE_OPTIONS: '--require evil.js' }
    })
    expect(result!.outputTail).not.toContain('ghp_secret_value')
    expect(result!.outputTail).not.toContain('aws_secret')
    expect(result!.outputTail).not.toContain('evil.js')
    expect(result!.outputTail).toContain('"CI":"1"')
  })

  it('refuses a cwd that escapes the workspace', async () => {
    const root = repo({ 'x.txt': '' })
    const [result] = await runChecks([spec([process.execPath, '-e', '0'], { cwd: '../..' })], opts(root))
    expect(result!.spawnError).toMatch(/escapes/)
  })
})
