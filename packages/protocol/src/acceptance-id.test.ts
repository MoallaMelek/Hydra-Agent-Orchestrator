import { expect, it, vi } from 'vitest'
import { newAcceptanceId } from './verification.js'

it('creates version-4 decision IDs with the cryptographic primitive available to HTTP phone pages', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes })
  vi.stubGlobal('crypto', { getRandomValues }) // Deliberately no secure-context randomUUID.
  try {
    expect(newAcceptanceId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(getRandomValues).toHaveBeenCalledOnce()
  } finally { vi.unstubAllGlobals() }
})
