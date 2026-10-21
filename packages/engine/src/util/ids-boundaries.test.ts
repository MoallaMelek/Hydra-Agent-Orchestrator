import { expect, it } from 'vitest'
import { newId, shortId } from './ids.js'

it('encodes timestamp boundaries without losing lexical ordering', () => {
  const times = [0, 31, 32, 1023, 1024, 2 ** 48 - 1]
  const ids = times.map(newId)
  expect([...ids].sort()).toEqual(ids)
  for (const id of ids) expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{26}$/)
  expect(ids[0]!.slice(0, 10)).toBe('0000000000')
  expect(ids.at(-1)!.slice(0, 10)).toBe('7zzzzzzzzz')
})

it('keeps entropy for simultaneous task IDs and uses the random suffix for display', () => {
  const ids = Array.from({ length: 1000 }, () => newId(123456))
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(ids.map((id) => id.slice(0, 10))).size).toBe(1)
  for (const id of ids) expect(shortId(id)).toBe(id.slice(-8))
})
