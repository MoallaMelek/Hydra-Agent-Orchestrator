import { describe, expect, it, vi } from 'vitest'
import { isAllowedRendererNavigation, isSafeExternalUrl, lockDownNavigation } from './navigation'

describe('Electron navigation policy', () => {
  it('allows only safe external protocols', () => {
    expect(isSafeExternalUrl('https://example.test/docs')).toBe(true)
    expect(isSafeExternalUrl('mailto:security@example.test')).toBe(true)
    expect(isSafeExternalUrl('http://example.test')).toBe(false)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects renderer navigation to a different origin or local file', () => {
    const renderer = 'http://127.0.0.1:5173/'
    expect(isAllowedRendererNavigation('http://127.0.0.1:5173/settings', renderer)).toBe(true)
    expect(isAllowedRendererNavigation('https://attacker.test/', renderer)).toBe(false)
    expect(isAllowedRendererNavigation('file:///etc/passwd', renderer)).toBe(false)
  })

  it('blocks unsafe popups without passing them to the OS shell', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    let openHandler: ((details: { url: string }) => { action: 'deny' }) | null = null
    const webContents = {
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => listeners.set(name, handler)),
      setWindowOpenHandler: vi.fn((handler) => { openHandler = handler })
    }
    const openExternal = vi.fn().mockResolvedValue(undefined)

    lockDownNavigation(
      webContents as never,
      'file:///opt/hydra/renderer/index.html',
      openExternal
    )
    const invokeOpenHandler = (url: string) => {
      if (!openHandler) throw new Error('Window-open handler was not installed')
      return openHandler({ url })
    }
    expect(invokeOpenHandler('javascript:alert(1)')).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(invokeOpenHandler('https://example.test/')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.test/')

    const preventDefault = vi.fn()
    listeners.get('will-navigate')?.({ preventDefault }, 'https://attacker.test/')
    expect(preventDefault).toHaveBeenCalled()
  })
})
