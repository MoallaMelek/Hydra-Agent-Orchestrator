export interface RemoteConnectionPayload {
  sessionId: string
  mobileToken: string
}

interface LegacyRemoteConnectionPayload extends RemoteConnectionPayload {
  projectId?: string
}

interface CustomTokenPayload {
  claims?: {
    sessionId?: unknown
  }
}

export function parseRemoteConnectionInput(
  input: string,
  expectedOrigin: string
): LegacyRemoteConnectionPayload {
  const value = input.trim()

  if (value.startsWith('{')) {
    const legacy = JSON.parse(value) as Partial<LegacyRemoteConnectionPayload>
    if (!legacy.sessionId || !legacy.mobileToken) {
      throw new Error('Remote session payload is incomplete.')
    }
    return {
      sessionId: legacy.sessionId,
      mobileToken: legacy.mobileToken,
      ...(legacy.projectId ? { projectId: legacy.projectId } : {})
    }
  }

  const url = new URL(value)
  if (url.protocol !== 'https:') {
    throw new Error('Remote mobile link must use HTTPS.')
  }
  if (url.origin !== expectedOrigin) {
    throw new Error('Remote mobile link belongs to a different Hydra Remote site.')
  }

  const mobileToken = new URLSearchParams(url.hash.slice(1)).get('token')?.trim()
  if (!mobileToken) throw new Error('Remote mobile link is missing its session token.')

  return {
    sessionId: readSessionIdFromCustomToken(mobileToken),
    mobileToken
  }
}

export function readRemoteLinkFromLocation(locationHref: string): string | null {
  const url = new URL(locationHref)
  return new URLSearchParams(url.hash.slice(1)).has('token') ? url.toString() : null
}

function readSessionIdFromCustomToken(token: string): string {
  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) throw new Error('Remote session token is malformed.')

  try {
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as CustomTokenPayload
    const sessionId = payload.claims?.sessionId
    if (typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new Error('missing session claim')
    }
    return sessionId
  } catch {
    throw new Error('Remote session token is malformed.')
  }
}
