import { describe, expect, it } from 'vitest'
import { hasValidMcpToken } from './McpServer'

describe('MCP transport authentication', () => {
  const token = '7'.repeat(64)

  it('rejects missing, malformed, and incorrect credentials', () => {
    expect(hasValidMcpToken(`Bearer ${token}`, token)).toBe(true)
    expect(hasValidMcpToken(undefined, token)).toBe(false)
    expect(hasValidMcpToken(`Basic ${token}`, token)).toBe(false)
    expect(hasValidMcpToken(`Bearer ${token}x`, token)).toBe(false)
  })
})
