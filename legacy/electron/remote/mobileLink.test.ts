import { afterEach, describe, expect, it } from 'vitest'
import { createMobileLink, getRemoteAppUrl } from './mobileLink'

const originalRemoteAppUrl = process.env.HYDRA_REMOTE_APP_URL

describe('Hydra Remote mobile links', () => {
  afterEach(() => {
    if (originalRemoteAppUrl === undefined) delete process.env.HYDRA_REMOTE_APP_URL
    else process.env.HYDRA_REMOTE_APP_URL = originalRemoteAppUrl
  })

  it('creates an HTTPS URL containing only the mobile token', () => {
    process.env.HYDRA_REMOTE_APP_URL = 'https://remote.example.test/'
    const link = createMobileLink('header.payload.signature')
    const url = new URL(link)

    expect(url.origin).toBe('https://remote.example.test')
    expect(new URLSearchParams(url.hash.slice(1)).get('token')).toBe('header.payload.signature')
    expect(url.search).toBe('')
    expect(link).not.toContain('sessionId')
    expect(link).not.toContain('projectId')
  })

  it('rejects a non-HTTPS remote app URL', () => {
    process.env.HYDRA_REMOTE_APP_URL = 'http://remote.example.test/'
    expect(() => getRemoteAppUrl()).toThrow('must use HTTPS')
  })

  it('requires a configured remote app URL', () => {
    delete process.env.HYDRA_REMOTE_APP_URL
    delete process.env.MAIN_VITE_HYDRA_REMOTE_APP_URL
    expect(() => getRemoteAppUrl()).toThrow('not configured')
  })
})
