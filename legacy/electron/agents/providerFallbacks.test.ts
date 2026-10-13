import { describe, expect, it } from 'vitest'
import { getDefaultModelForProvider, PROVIDER_MODELS } from '@shared/types'

describe('provider model fallbacks', () => {
  it('uses the verified ChatGPT-compatible Codex fallback', () => {
    expect(getDefaultModelForProvider('codex')).toBe('gpt-5.6-sol')
    expect(PROVIDER_MODELS.codex.map((model) => model.id)).not.toContain('gpt-5.3-codex')
  })
})
