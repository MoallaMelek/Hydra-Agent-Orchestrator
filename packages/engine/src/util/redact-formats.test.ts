import { expect, it } from 'vitest'
import { redact } from './redact.js'

it('masks repeated provider credentials without retaining a usable token', () => {
  const tokens = [
    `sk-ant-${'a'.repeat(24)}`, `sk-proj-${'b'.repeat(24)}`,
    `ghp_${'c'.repeat(36)}`, `github_pat_${'d'.repeat(50)}`,
    `AKIA${'A'.repeat(16)}`, `AIza${'e'.repeat(35)}`
  ]
  for (const token of tokens) {
    const result = redact(`first ${token}\nsecond ${token}`)
    expect(result).not.toContain(token)
    expect(result.match(/\[redacted/g)).toHaveLength(2)
  }
})

it('masks multiline private keys and remains idempotent', () => {
  const text = 'before\n-----BEGIN RSA PRIVATE KEY-----\nprivate fixture\n-----END RSA PRIVATE KEY-----\nafter'
  const result = redact(text)
  expect(result).toBe('before\n[redacted private key]\nafter')
  expect(redact(result)).toBe(result)
})

it('preserves ordinary diagnostics that contain no credential', () => {
  const text = 'Task failed at src/token.ts:42; retry after 2 seconds.'
  expect(redact(text)).toBe(text)
})
