import { describe, expect, it } from 'vitest'
import { buildSessionImportOptions } from './sessionImportOptions'

describe('buildSessionImportOptions', () => {
  it('applies the configured age, limit, project prefix, and hidden sessions', () => {
    expect(buildSessionImportOptions({
      sessionImportLimit: 500,
      sessionMaxAgeDays: 7,
      sessionImportProjectPrefix: 'C:\\Users\\test\\hydra',
      hiddenSessionIds: ['hidden-session']
    })).toEqual({
      limit: 500,
      maxAgeDays: 7,
      projectPathPrefix: 'C:\\Users\\test\\hydra',
      hiddenSessionIds: ['hidden-session']
    })
  })

  it('maps zero limits to an unbounded catalog query', () => {
    expect(buildSessionImportOptions({
      sessionImportLimit: 0,
      sessionMaxAgeDays: 0,
      sessionImportProjectPrefix: '',
      hiddenSessionIds: []
    })).toEqual({
      limit: undefined,
      maxAgeDays: undefined,
      projectPathPrefix: undefined,
      hiddenSessionIds: []
    })
  })
})
