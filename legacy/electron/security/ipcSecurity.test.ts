import { beforeEach, describe, expect, it, vi } from 'vitest'

const fromWebContents = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents }
}))

import { assertTrustedIpcSender } from './ipcSecurity'

describe('privileged IPC caller validation', () => {
  beforeEach(() => {
    fromWebContents.mockReset()
    fromWebContents.mockReturnValue({ isDestroyed: () => false })
  })

  function event(url: string, isMainFrame = true) {
    const mainFrame = { url }
    return {
      sender: { mainFrame },
      senderFrame: isMainFrame ? mainFrame : { url }
    }
  }

  it('accepts the attached main frame on the renderer origin', () => {
    expect(() => assertTrustedIpcSender(
      event('http://127.0.0.1:5173/settings') as never,
      'http://127.0.0.1:5173/'
    )).not.toThrow()
  })

  it('rejects subframes, navigated senders, and unattached webContents', () => {
    expect(() => assertTrustedIpcSender(
      event('http://127.0.0.1:5173/', false) as never,
      'http://127.0.0.1:5173/'
    )).toThrow('Untrusted IPC sender')
    expect(() => assertTrustedIpcSender(
      event('https://attacker.test/') as never,
      'http://127.0.0.1:5173/'
    )).toThrow('Untrusted IPC sender')

    fromWebContents.mockReturnValueOnce(null)
    expect(() => assertTrustedIpcSender(
      event('http://127.0.0.1:5173/') as never,
      'http://127.0.0.1:5173/'
    )).toThrow('Untrusted IPC sender')
  })
})
