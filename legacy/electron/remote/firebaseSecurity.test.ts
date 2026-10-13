import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

describe('Firebase authorization policy', () => {
  const root = process.cwd()
  const rules = readFileSync(join(root, 'firebase-backend', 'firestore.rules'), 'utf8')
  const functions = readFileSync(
    join(root, 'firebase-backend', 'functions', 'src', 'index.ts'),
    'utf8'
  )

  it('separates host and mobile roles and enforces active expiry', () => {
    expect(rules).toContain('request.auth.token.role == role')
    expect(rules).toContain("hasRole(sessionId, 'host')")
    expect(rules).toContain("hasRole(sessionId, 'mobile')")
    expect(rules).toContain("get(sessionPath(sessionId)).data.status == 'active'")
    expect(rules).toContain('get(sessionPath(sessionId)).data.expiresAt > request.time')
  })

  it('prevents mobile writes to host state and unsafe inbox commands', () => {
    expect(rules).toContain("request.resource.data.type in ['handshake', 'prompt']")
    expect(rules).toContain('allow create, update, delete: if isHost(sessionId);')
    expect(rules).not.toContain('allow read, write: if request.auth')
  })

  it('issues role claims and recursively deletes sessions', () => {
    expect(functions).toContain("{ sessionId, role: 'host' }")
    expect(functions).toContain("{ sessionId, role: 'mobile' }")
    expect(functions).toContain('export const deleteSession')
    expect(functions).toContain('db.recursiveDelete')
  })
})
