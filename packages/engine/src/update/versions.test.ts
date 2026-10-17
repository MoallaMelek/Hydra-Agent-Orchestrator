import { expect, it } from 'vitest'
import { compareVersions } from './updater.js'

it.each([
  ['2.0.0-alpha.2', '2.0.0-alpha.10', -1],
  ['2.0.0-alpha', '2.0.0-alpha.1', -1],
  ['2.0.0-2', '2.0.0-alpha', -1],
  ['2.0.0-alpha-one', '2.0.0-alpha-two', -1],
  ['2.0.0+build.1', '2.0.0+build.2', 0],
  ['2.0.0-alpha.01', '2.0.0-alpha.1', 0]
])('compares SemVer precedence: %s and %s', (a, b, order) => {
  expect(compareVersions(a, b)).toBe(order)
  expect(compareVersions(b, a)).toBe(-order || 0)
})
