import { describe, expect, it } from 'vitest'
import { emptyUsage, type Task } from '@hydra/protocol'
import { agentEnv, verificationEnv } from './process/env.js'
import { redact } from './util/redact.js'
import { addUsage, assertCanStartRun } from './workflow/budget.js'
import { KeyedMutex } from './orchestrator/orchestrator.js'

const ENV = {
  PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'anthropic-secret', CLAUDE_CONFIG_DIR: '/c', OPENAI_API_KEY: 'openai-secret', CODEX_HOME: '/x',
  AWS_SECRET_ACCESS_KEY: 'aws', GITHUB_TOKEN: 'gh', NODE_OPTIONS: '--require evil', GIT_DIR: '/elsewhere', HTTPS_PROXY: 'http://proxy', DATABASE_URL: 'postgres://x'
}

describe('environment isolation', () => {
  it('gives each CLI only its own vendor settings, never the other vendor\'s key or unrelated secrets', () => {
    const claude = agentEnv('claude', ENV)
    expect(claude.ANTHROPIC_API_KEY).toBe('anthropic-secret')
    expect(claude.OPENAI_API_KEY).toBeUndefined()
    const codex = agentEnv('codex', ENV)
    expect(codex.OPENAI_API_KEY).toBe('openai-secret')
    expect(codex.ANTHROPIC_API_KEY).toBeUndefined()
    for (const env of [claude, codex]) {
      for (const key of ['AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'GIT_DIR', 'DATABASE_URL']) expect(env[key]).toBeUndefined()
      expect(env.PATH).toBe('/usr/bin')
      expect(env.HTTPS_PROXY).toBe('http://proxy')
    }
  })

  it('gives checks no provider credentials at all', () => {
    const env = verificationEnv(ENV)
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'HTTPS_PROXY']) expect(env[key]).toBeUndefined()
    expect(env.CI).toBe('1')
  })
})

describe('secret redaction', () => {
  it('masks common credential formats', () => {
    const text = [
      'key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', 'openai sk-proj-abcdefghijklmnopqrstuvwxyz012345',
      'gh ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'aws AKIAABCDEFGHIJKLMNOP',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'password=hunter2hunter2', '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'
    ].join('\n')
    const out = redact(text)
    for (const secret of ['sk-ant-api03', 'sk-proj-abc', 'ghp_abc', 'AKIAABCD', 'eyJhbGci', 'hunter2', 'MIIabc']) expect(out).not.toContain(secret)
    expect(redact('ordinary test output: 3 passed')).toBe('ordinary test output: 3 passed')
  })
})

describe('budgets', () => {
  const task = (usage = emptyUsage()): Task => ({ budget: { maxCostUsd: 1, maxTokens: 1000, maxWallMinutes: 60, maxAgentRuns: 5, maxFixRounds: 1 }, usage, stages: [] } as unknown as Task)

  it('counts unpriced runs as tokens instead of $0', () => {
    const usage = addUsage(emptyUsage(), { inputTokens: 600, outputTokens: 100, cachedTokens: 50, costUsd: null })
    expect(usage.costUsd).toBe(0)
    expect(usage.unpricedTokens).toBe(700)
  })

  it('limits are inclusive: a reached cap blocks the next run', () => {
    expect(() => assertCanStartRun(task({ ...emptyUsage(), costUsd: 1 }))).toThrow(/Cost limit reached/)
    expect(() => assertCanStartRun(task({ ...emptyUsage(), inputTokens: 1000 }))).toThrow(/Token limit reached/)
    expect(() => assertCanStartRun(task({ ...emptyUsage(), agentRuns: 5 }))).toThrow(/run limit/)
    expect(() => assertCanStartRun(task())).not.toThrow()
  })
})

describe('repository mutex', () => {
  it('serializes operations on the same repository (case-insensitive on Windows)', async () => {
    const mutex = new KeyedMutex()
    const order: string[] = []
    const slow = (label: string, ms: number) => mutex.run(process.platform === 'win32' && label === 'b' ? 'C:\\REPO' : 'C:\\repo', async () => {
      order.push(`${label}:start`)
      await new Promise((r) => setTimeout(r, ms))
      order.push(`${label}:end`)
    })
    await Promise.all([slow('a', 40), slow('b', 5)])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })
})
