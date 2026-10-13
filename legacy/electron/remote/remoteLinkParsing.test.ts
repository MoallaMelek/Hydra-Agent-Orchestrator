import { describe, expect, it } from 'vitest'
import {
  parseRemoteConnectionInput,
  readRemoteLinkFromLocation
} from '../../shared/remoteLink'

function createUnsignedTestToken(sessionId: string): string {
  const encode = (value: object) => btoa(JSON.stringify(value))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ claims: { sessionId } })}.signature`
}

describe('Hydra Remote link parsing', () => {
  it('extracts the authenticated session from an HTTPS deep link', () => {
    const token = createUnsignedTestToken('session-123')
    const link = `https://remote.example.test/#${new URLSearchParams({ token })}`

    expect(parseRemoteConnectionInput(link, 'https://remote.example.test')).toEqual({
      sessionId: 'session-123',
      mobileToken: token
    })
    expect(readRemoteLinkFromLocation(link)).toBe(link)
  })

  it('keeps legacy JSON QR payloads compatible', () => {
    const legacy = JSON.stringify({
      sessionId: 'session-legacy',
      mobileToken: 'legacy-token',
      projectId: 'legacy-project'
    })
    expect(parseRemoteConnectionInput(legacy, 'https://remote.example.test')).toEqual({
      sessionId: 'session-legacy',
      mobileToken: 'legacy-token',
      projectId: 'legacy-project'
    })
  })

  it('rejects links from a different origin', () => {
    const token = createUnsignedTestToken('session-123')
    const link = `https://wrong.example.test/#${new URLSearchParams({ token })}`
    expect(() => parseRemoteConnectionInput(link, 'https://remote.example.test')).toThrow(
      'different Hydra Remote site'
    )
  })
})
