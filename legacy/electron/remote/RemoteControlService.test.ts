/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Use vi.hoisted() to ensure mock variables are available before vi.mock() factories run
const {
  mockInitializeApp,
  mockDeleteApp,
  mockGetFirestore,
  mockGetAuth,
  mockSignInWithCustomToken,
  mockGetIdTokenResult,
  mockSignOut,
  mockOnSnapshot,
  mockSetDoc,
  mockDeleteDoc,
  mockAddDoc,
  mockUpdateDoc,
  mockGetFunctions,
  mockCreateSessionFn,
  mockDeleteSessionFn,
  mockHttpsCallable
} = vi.hoisted(() => {
  const mockCreateSessionFn = vi.fn()
  const mockDeleteSessionFn = vi.fn()
  return {
    mockInitializeApp: vi.fn(() => ({ name: 'hydra-remote' })),
    mockDeleteApp: vi.fn(),
    mockGetFirestore: vi.fn(() => ({})),
    mockGetAuth: vi.fn(() => ({})),
    mockSignInWithCustomToken: vi.fn(async () => ({ user: {} })),
    mockGetIdTokenResult: vi.fn(async () => ({
      claims: { sessionId: 'test-session-123', role: 'host' }
    })),
    mockSignOut: vi.fn(async () => undefined),
    mockOnSnapshot: vi.fn(() => vi.fn()),
    mockSetDoc: vi.fn(async () => undefined),
    mockDeleteDoc: vi.fn(async () => undefined),
    mockAddDoc: vi.fn(async () => ({})),
    mockUpdateDoc: vi.fn(async () => undefined),
    mockGetFunctions: vi.fn(() => ({})),
    mockCreateSessionFn,
    mockDeleteSessionFn,
    mockHttpsCallable: vi.fn((_functions: unknown, name: string) =>
      name === 'deleteSession' ? mockDeleteSessionFn : mockCreateSessionFn
    )
  }
})

vi.mock('firebase/app', () => ({
  initializeApp: mockInitializeApp,
  deleteApp: mockDeleteApp
}))

vi.mock('firebase/firestore', () => ({
  getFirestore: mockGetFirestore,
  collection: vi.fn(),
  doc: vi.fn(),
  addDoc: mockAddDoc,
  setDoc: mockSetDoc,
  deleteDoc: mockDeleteDoc,
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: mockOnSnapshot,
  updateDoc: mockUpdateDoc
}))

vi.mock('firebase/auth', () => ({
  getAuth: mockGetAuth,
  signInWithCustomToken: mockSignInWithCustomToken,
  getIdTokenResult: mockGetIdTokenResult,
  signOut: mockSignOut
}))

vi.mock('firebase/functions', () => ({
  getFunctions: mockGetFunctions,
  httpsCallable: mockHttpsCallable
}))

class MockAgentManager extends EventEmitter {
  list() {
    return [
      {
        id: 'agent-1',
        name: 'Test Agent',
        status: 'running' as const,
        model: 'sonnet',
        provider: 'claude' as const,
        projectDir: '/test/project',
        sessionId: 'sess-1',
        pid: 123,
        restartCount: 0,
        startedAt: new Date().toISOString(),
        yolo: false,
        isManager: false,
        initialPrompt: 'test',
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        reasoningEffort: undefined
      }
    ]
  }
  get(agentId: string) {
    if (agentId === 'agent-1') {
      return this.list()[0]
    }
    return null
  }
  sendInput = vi.fn()
  kill = vi.fn()
  create = vi.fn()
  restart = vi.fn()
  broadcast = vi.fn()
}

class MockNotificationService {
  subscribe = vi.fn(() => vi.fn())
}

import { fitOutboxPayload, RemoteControlService } from './RemoteControlService'

const TEST_FIREBASE_ENV = {
  HYDRA_FIREBASE_API_KEY: 'test-key',
  HYDRA_FIREBASE_AUTH_DOMAIN: 'example-project.firebaseapp.com',
  HYDRA_FIREBASE_PROJECT_ID: 'example-project',
  HYDRA_FIREBASE_STORAGE_BUCKET: 'example-project.firebasestorage.app',
  HYDRA_FIREBASE_MESSAGING_SENDER_ID: '000',
  HYDRA_FIREBASE_APP_ID: '1:000:web:000',
  HYDRA_REMOTE_APP_URL: 'https://remote.example.test/'
} as const
const TEST_FIREBASE_ENV_KEYS = Object.keys(TEST_FIREBASE_ENV) as Array<
  keyof typeof TEST_FIREBASE_ENV
>

describe('RemoteControlService', () => {
  let service: RemoteControlService
  let agentManager: MockAgentManager
  let notificationService: MockNotificationService
  const originalFirebaseEnv = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of TEST_FIREBASE_ENV_KEYS) {
      originalFirebaseEnv.set(key, process.env[key])
      process.env[key] = TEST_FIREBASE_ENV[key]
    }

    // Reset the createSession mock implementation before each test
    mockCreateSessionFn.mockResolvedValue({
      data: {
        sessionId: 'test-session-123',
        hostToken: 'host-token-abc',
        mobileToken: 'mobile-token-xyz',
        expiresAt: new Date(Date.now() + 480 * 60 * 1000).toISOString()
      }
    })
    mockHttpsCallable.mockReturnValue(mockCreateSessionFn)
    mockDeleteSessionFn.mockResolvedValue({ data: { deleted: true } })
    mockHttpsCallable.mockImplementation((_functions: unknown, name: string) =>
      name === 'deleteSession' ? mockDeleteSessionFn : mockCreateSessionFn
    )

    agentManager = new MockAgentManager()
    notificationService = new MockNotificationService()
    service = new RemoteControlService(
      agentManager as never,
      notificationService as never,
      480
    )
  })

  afterEach(() => {
    service.destroy()

    for (const key of TEST_FIREBASE_ENV_KEYS) {
      const previous = originalFirebaseEnv.get(key)
      if (typeof previous === 'undefined') {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    }
    originalFirebaseEnv.clear()
  })

  describe('getState()', () => {
    it('returns initial disabled state', () => {
      const state = service.getState()
      expect(state.enabled).toBe(false)
      expect(state.status).toBe('disconnected')
      expect(state.sessionId).toBeNull()
      expect(state.qrPayload).toBeNull()
    })
  })

  describe('enable()', () => {
    // First test in the suite pays for cold-import of firebase/* modules on slow
    // CI runners (observed 325ms vs ~3ms warm). Retry once to absorb that race.
    it('creates a session and transitions to active', { retry: 2 }, async () => {
      const state = await service.enable()

      expect(state.enabled).toBe(true)
      expect(state.status).toBe('active')
      expect(state.sessionId).toBe('test-session-123')
      expect(state.qrPayload).toBeTruthy()
      expect(state.connectedAt).toBeTruthy()

      // QR payload is a normal HTTPS link containing only the session token.
      const qr = new URL(state.qrPayload!)
      expect(qr.origin).toBe('https://remote.example.test')
      expect(new URLSearchParams(qr.hash.slice(1)).get('token')).toBe('mobile-token-xyz')
      expect(state.qrPayload).not.toContain('projectId')
      expect(state.qrPayload).not.toContain('sessionId')
    })

    it('is idempotent when already enabled', async () => {
      await service.enable()
      const state2 = await service.enable()
      expect(state2.enabled).toBe(true)
      expect(state2.sessionId).toBe('test-session-123')
    })

    it('emits state-changed events', async () => {
      const events: unknown[] = []
      service.on('state-changed', (s) => events.push(s))

      await service.enable()

      // Should emit multiple state changes (creating, then active)
      expect(events.length).toBeGreaterThanOrEqual(2)
    })

    it('subscribes to notification service', async () => {
      await service.enable()
      expect(notificationService.subscribe).toHaveBeenCalledOnce()
    })

    it('publishes remote session heartbeat metadata', async () => {
      await service.enable()

      expect(
        (mockUpdateDoc.mock.calls as Array<unknown[]>).some((call) => {
          const payload = call[1] as Record<string, unknown> | undefined
          return (
          Boolean(payload) &&
          typeof payload === 'object' &&
          payload.status === 'active' &&
          payload.hostConnected === true &&
          payload.agentCount === 1
          )
        })
      ).toBe(true)
    })

    it('rejects legacy destructive inbox commands at runtime', async () => {
      await service.enable()
      const onSnapshotCalls = mockOnSnapshot.mock.calls as unknown as Array<unknown[]>
      const listener = onSnapshotCalls[0]?.[1] as ((snapshot: unknown) => void) | undefined
      expect(listener).toBeTypeOf('function')

      listener?.({
        docChanges: () => [{
          type: 'added',
          doc: {
            id: 'malicious-command',
            data: () => ({
              type: 'kill',
              payload: { agentId: 'agent-1' },
              timestamp: new Date().toISOString(),
              processed: false
            })
          }
        }]
      })

      expect(agentManager.kill).not.toHaveBeenCalled()
      expect(agentManager.sendInput).not.toHaveBeenCalled()
    })

    it('times out and surfaces an error when session creation stalls', async () => {
      mockCreateSessionFn.mockImplementationOnce(() => new Promise(() => {}))

      const timeoutService = new RemoteControlService(
        agentManager as never,
        notificationService as never,
        480,
        20
      )

      const state = await timeoutService.enable()

      expect(state.enabled).toBe(false)
      expect(state.status).toBe('error')
      expect(state.error).toContain('Timed out creating remote session.')

      timeoutService.destroy()
    })
  })

  describe('disable()', () => {
    it('transitions to disabled state', async () => {
      await service.enable()
      const state = await service.disable()

      expect(state.enabled).toBe(false)
      expect(state.status).toBe('disconnected')
      expect(state.sessionId).toBeNull()
      expect(state.qrPayload).toBeNull()
      expect(mockDeleteSessionFn).toHaveBeenCalledWith({ sessionId: 'test-session-123' })
    })

    it('is safe to call when already disabled', async () => {
      const state = await service.disable()
      expect(state.enabled).toBe(false)
    })
  })

  describe('setTimeoutMinutes()', () => {
    it('clamps timeout to valid range', () => {
      service.setTimeoutMinutes(10)
      // Should be clamped to 30 minimum — internal state
      service.setTimeoutMinutes(2000)
      // Should be clamped to 1440 maximum — internal state
    })
  })

  describe('destroy()', () => {
    it('cleans up without errors', async () => {
      await service.enable()
      expect(() => service.destroy()).not.toThrow()
    })

    it('is safe to call when not enabled', () => {
      expect(() => service.destroy()).not.toThrow()
    })
  })
})

describe('fitOutboxPayload', () => {
  it('bounds conversation history by UTF-8 bytes and keeps recent messages', () => {
    const messages = Array.from({ length: 50 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `${index}:${'é'.repeat(4000)}`,
      timestamp: new Date(index * 1000).toISOString()
    }))

    const fitted = fitOutboxPayload({ agentId: 'agent-1', messages }, 50_000)
    expect(Buffer.byteLength(JSON.stringify(fitted), 'utf8')).toBeLessThanOrEqual(50_000)
    expect(fitted.truncated).toBe(true)
    const kept = fitted.messages as typeof messages
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.at(-1)?.text.startsWith('49:')).toBe(true)
  })

  it('truncates a single oversized output chunk by actual byte size', () => {
    const fitted = fitOutboxPayload({ agentId: 'agent-1', lines: ['🔥'.repeat(30_000)] }, 10_000)
    expect(Buffer.byteLength(JSON.stringify(fitted), 'utf8')).toBeLessThanOrEqual(10_000)
    expect(fitted.truncated).toBe(true)
    expect((fitted.lines as string[])).toHaveLength(1)
  })
})
