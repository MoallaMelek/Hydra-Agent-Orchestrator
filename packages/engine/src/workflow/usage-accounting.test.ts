import { expect, it } from 'vitest'
import { emptyUsage } from '@hydra/protocol'
import { addUsage, billableTokens } from './budget.js'

it('accounts for unpriced CLI tokens without inventing a dollar price', () => {
  const initial = emptyUsage()
  const result = addUsage(initial, { inputTokens: 100, outputTokens: 20, cachedTokens: 30, costUsd: null })
  // Cached input counts as reported usage (see 448db2a: the token guard must include it).
  expect(result.unpricedTokens).toBe(150)
  expect(result.costUsd).toBe(0)
  expect(result.cachedTokens).toBe(30)
  expect(billableTokens(result)).toBe(150)
  expect(initial).toEqual(emptyUsage())
})

it('accumulates mixed priced and unpriced reports without double counting cached tokens', () => {
  const first = addUsage(emptyUsage(), { inputTokens: 10, outputTokens: 5, cachedTokens: 4, costUsd: null })
  const total = addUsage(first, { inputTokens: 20, outputTokens: 3, cachedTokens: 7, costUsd: 0.25 })
  expect(total).toEqual({ inputTokens: 30, outputTokens: 8, cachedTokens: 11, costUsd: 0.25, unpricedTokens: 19, agentRuns: 0 })
  expect(billableTokens(total)).toBe(49)
})

it('distinguishes a provider-reported zero price from an unknown price', () => {
  const total = addUsage(emptyUsage(), { inputTokens: 7, outputTokens: 1, cachedTokens: 0, costUsd: 0 })
  expect(total.unpricedTokens).toBe(0)
  expect(billableTokens(total)).toBe(8)
})
