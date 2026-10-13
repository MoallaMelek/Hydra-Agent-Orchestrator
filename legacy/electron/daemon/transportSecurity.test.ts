import { describe, expect, it } from 'vitest'
import { hasValidBearerToken } from './DaemonServer'

describe('daemon transport authentication', () => {
  const token = 'a'.repeat(64)

  it('accepts only the exact bearer token', () => {
    expect(hasValidBearerToken(`Bearer ${token}`, token)).toBe(true)
    expect(hasValidBearerToken(undefined, token)).toBe(false)
    expect(hasValidBearerToken(token, token)).toBe(false)
    expect(hasValidBearerToken(`Bearer ${'b'.repeat(64)}`, token)).toBe(false)
    expect(hasValidBearerToken([`Bearer ${token}`], token)).toBe(false)
  })
})
