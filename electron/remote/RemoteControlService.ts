import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { hostname } from 'os'
import type { NotificationService } from '../notifications/NotificationService'
import type { DaemonNotificationService } from '../daemon/DaemonNotificationService'
import { getFirebaseConfig } from './firebaseConfig'
import { createMobileLink } from './mobileLink'
import { z } from 'zod'
import { remoteTaskSummary } from '@shared/remoteTasks'
import type { HydraTask } from '@shared/tasks'
import type {
  AgentState,
  RemoteControlState,
  RemoteAgentSummary,
  AgentStatusPayload,
  AgentOutputPayload,
  HydraNotification
} from '@shared/types'

/**
 * Minimal interface satisfied by both AgentManager (direct) and DaemonClient (proxy).
 */
interface AgentBackend extends EventEmitter {
  list(): AgentState[] | Promise<AgentState[]>
  get(agentId: string): AgentState | null | Promise<AgentState | null>
  sendInput(agentId: string, input: string): boolean | void | Promise<void>
  listTasks?(): Promise<HydraTask[]>
}

// Firebase SDK — lazy-imported so the module can be loaded even if firebase
// is not yet installed (tests, builds without the dep, etc.).
type FirebaseApp = import('firebase/app').FirebaseApp
type Firestore = import('firebase/firestore').Firestore
type Auth = import('firebase/auth').Auth
type Unsubscribe = () => void

const OUTPUT_FLUSH_INTERVAL_MS = 2000
const MAX_OUTBOX_PAYLOAD_BYTES = 50_000
const ENABLE_PHASE_TIMEOUT_MS = 15_000
const SESSION_HEARTBEAT_INTERVAL_MS = 15_000
const remoteInboxSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('handshake'),
    payload: z.object({ source: z.literal('hydra-remote-mobile') }).strict(),
    timestamp: z.string().datetime(),
    processed: z.literal(false)
  }).passthrough(),
  z.object({
    type: z.literal('prompt'),
    payload: z.object({
      agentId: z.string().trim().min(1).max(128),
      input: z.string().trim().min(1).max(20_000)
    }).strict(),
    timestamp: z.string().datetime(),
    processed: z.literal(false)
  }).passthrough()
])
const createSessionResponseSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  hostToken: z.string().min(1).max(16_384),
  mobileToken: z.string().min(1).max(16_384),
  expiresAt: z.string().datetime()
}).strict()
type SafeRemoteInboxMessage = z.infer<typeof remoteInboxSchema>

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function truncateTextToFit(
  payload: Record<string, unknown>,
  arrayKey: string,
  item: string | Record<string, unknown>,
  maxBytes: number
): string | Record<string, unknown> | null {
  const sourceText = typeof item === 'string'
    ? item
    : typeof item.text === 'string'
      ? item.text
      : null
  if (sourceText === null) return null

  let low = 0
  let high = sourceText.length
  let best: string | Record<string, unknown> | null = null
  while (low <= high) {
    const length = Math.floor((low + high) / 2)
    const tail = sourceText.slice(sourceText.length - length)
    const candidate = typeof item === 'string' ? tail : { ...item, text: tail }
    if (jsonByteLength({ ...payload, [arrayKey]: [candidate] }) <= maxBytes) {
      best = candidate
      low = length + 1
    } else {
      high = length - 1
    }
  }
  return best
}

export function fitOutboxPayload(
  payload: Record<string, unknown>,
  maxBytes: number = MAX_OUTBOX_PAYLOAD_BYTES
): Record<string, unknown> {
  if (jsonByteLength(payload) <= maxBytes) return payload

  const fitted: Record<string, unknown> = { ...payload, truncated: true }
  const arrayKey = Array.isArray(payload.messages)
    ? 'messages'
    : Array.isArray(payload.lines)
      ? 'lines'
      : null

  if (!arrayKey) return { truncated: true }

  const source = payload[arrayKey] as unknown[]
  const kept: unknown[] = []
  fitted[arrayKey] = kept

  for (let index = source.length - 1; index >= 0; index--) {
    kept.unshift(source[index])
    if (jsonByteLength(fitted) <= maxBytes) continue
    kept.shift()

    if (kept.length === 0) {
      const item = source[index]
      if (typeof item === 'string' || (item !== null && typeof item === 'object')) {
        const shortened = truncateTextToFit(
          fitted,
          arrayKey,
          item as string | Record<string, unknown>,
          maxBytes
        )
        if (shortened !== null) kept.push(shortened)
      }
    }
    break
  }

  return fitted
}

export class RemoteControlService extends EventEmitter {
  private state: RemoteControlState = {
    enabled: false,
    status: 'disconnected',
    sessionId: null,
    qrPayload: null,
    connectedAt: null,
    expiresAt: null,
    mobileConnected: false,
    error: null
  }

  private firebaseApp: FirebaseApp | null = null
  private firestore: Firestore | null = null
  private auth: Auth | null = null

  private inboxUnsubscribe: Unsubscribe | null = null
  private agentOutputUnsub: Unsubscribe | null = null
  private agentStatusUnsub: Unsubscribe | null = null
  private notificationUnsub: Unsubscribe | null = null

  private outputBuffers = new Map<string, string[]>()
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private sessionHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null
  private taskSyncTimer: ReturnType<typeof setInterval> | null = null
  private inboxInFlight = new Set<string>()
  private inboxDelivered = new Set<string>()

  constructor(
    private agentManager: AgentBackend,
    private notificationService: NotificationService | DaemonNotificationService,
    private timeoutMinutes: number = 480,
    private enablePhaseTimeoutMs: number = ENABLE_PHASE_TIMEOUT_MS
  ) {
    super()
  }

  getState(): RemoteControlState {
    return { ...this.state }
  }

  async enable(): Promise<RemoteControlState> {
    if (this.state.enabled) return this.getState()

    this.updateState({
      enabled: true,
      status: 'creating',
      error: null,
      connectedAt: null,
      mobileConnected: false
    })

    try {
      await this.withTimeout(
        this.initFirebase(),
        this.enablePhaseTimeoutMs,
        'Timed out initializing remote control.'
      )
      await this.withTimeout(
        this.createSession(),
        this.enablePhaseTimeoutMs,
        'Timed out creating remote session.'
      )
      this.attachAgentListeners()
      this.startOutputFlushing()
      await this.withTimeout(
        this.syncAgentState(),
        this.enablePhaseTimeoutMs,
        'Timed out syncing remote agent state.'
      )

      this.startSessionHeartbeat()
      this.taskSyncTimer = setInterval(() => { void this.syncTaskState().catch(() => {}) }, 5000)
      this.updateState({ status: 'active', connectedAt: new Date().toISOString() })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.detachAllListeners()
      this.stopOutputFlushing()
      this.stopSessionHeartbeat()
      this.stopSessionExpiryTimer()
      this.updateState({
        enabled: false,
        status: 'error',
        sessionId: null,
        qrPayload: null,
        connectedAt: null,
        expiresAt: null,
        mobileConnected: false,
        error: message
      })
    }

    return this.getState()
  }

  async disable(): Promise<RemoteControlState> {
    if (this.taskSyncTimer) { clearInterval(this.taskSyncTimer); this.taskSyncTimer = null }
    if (!this.state.enabled) return this.getState()

    this.detachAllListeners()
    this.stopOutputFlushing()
    this.stopSessionHeartbeat()
    this.stopSessionExpiryTimer()

    // Revoke access immediately, then ask the trusted backend to recursively
    // remove the session and all nested documents.
    if (this.firebaseApp && this.state.sessionId) {
      const sessionId = this.state.sessionId
      try {
        await this.writeSessionMetadata({ status: 'closed', hostConnected: false })
      } catch {
        // Expired rules may already reject the status update.
      }
      try {
        const { getFunctions, httpsCallable } = await import('firebase/functions')
        const deleteSessionFn = httpsCallable<{ sessionId: string }, { deleted: boolean }>(
          getFunctions(this.firebaseApp),
          'deleteSession'
        )
        await deleteSessionFn({ sessionId })
      } catch {
        // Scheduled cleanup remains a fallback for expired roots.
      }
    }

    // Sign out
    if (this.auth) {
      try {
        const { signOut } = await import('firebase/auth')
        await signOut(this.auth)
      } catch {
        // Best effort
      }
    }

    this.updateState({
      enabled: false,
      status: 'disconnected',
      sessionId: null,
      qrPayload: null,
      connectedAt: null,
      expiresAt: null,
      mobileConnected: false,
      error: null
    })

    return this.getState()
  }

  destroy(): void {
    if (this.taskSyncTimer) clearInterval(this.taskSyncTimer)
    this.detachAllListeners()
    this.stopOutputFlushing()
    this.stopSessionHeartbeat()
    this.stopSessionExpiryTimer()

    if (this.firebaseApp) {
      const app = this.firebaseApp
      const cleanup = this.state.enabled ? this.disable() : Promise.resolve(this.getState())
      void cleanup.finally(() => {
        if (this.firebaseApp === app) this.firebaseApp = null
        import('firebase/app').then(({ deleteApp }) => deleteApp(app)).catch(() => {/* ignore */})
      })
    }
  }

  setTimeoutMinutes(minutes: number): void {
    this.timeoutMinutes = Math.min(Math.max(minutes, 30), 1440)
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error(message))
      }, timeoutMs)

      promise
        .then((value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        })
        .catch((err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  // ── Firebase init ─────────────────────────────────────────────────────────

  private async initFirebase(): Promise<void> {
    if (this.firebaseApp) return

    const firebaseConfig = getFirebaseConfig()
    const { initializeApp } = await import('firebase/app')
    const { getFirestore } = await import('firebase/firestore')
    const { getAuth } = await import('firebase/auth')

    this.firebaseApp = initializeApp(firebaseConfig, 'hydra-remote')
    this.firestore = getFirestore(this.firebaseApp)
    this.auth = getAuth(this.firebaseApp)
  }

  // ── Session creation ──────────────────────────────────────────────────────

  private async createSession(): Promise<void> {
    if (!this.firebaseApp) throw new Error('Firebase not initialized')

    const { getFunctions, httpsCallable } = await import('firebase/functions')
    const { getIdTokenResult, signInWithCustomToken } = await import('firebase/auth')

    const functions = getFunctions(this.firebaseApp)
    const createSessionFn = httpsCallable<
      { hostName: string; timeoutMinutes: number },
      { sessionId: string; hostToken: string; mobileToken: string; expiresAt: string }
    >(functions, 'createSession')

    const result = await createSessionFn({
      hostName: hostname(),
      timeoutMinutes: this.timeoutMinutes
    })

    const { sessionId, hostToken, mobileToken, expiresAt } = createSessionResponseSchema.parse(result.data)

    // Authenticate as host
    if (!this.auth) throw new Error('Auth not initialized')
    const credential = await signInWithCustomToken(this.auth, hostToken)
    const token = await getIdTokenResult(credential.user)
    if (token.claims.sessionId !== sessionId || token.claims.role !== 'host') {
      throw new Error('Remote host credential has invalid authorization claims')
    }

    // The custom token already carries the sessionId claim. Encoding only the
    // HTTPS deep link avoids duplicating session/config metadata in the QR.
    const qrPayload = createMobileLink(mobileToken)

    this.updateState({ sessionId, qrPayload, expiresAt })
    this.startSessionExpiryTimer(expiresAt)
    await this.writeSessionMetadata({
      status: 'active',
      hostConnected: true,
      connectedAt: new Date().toISOString()
    })

    // Attach inbox listener
    this.attachInboxListener(sessionId)
  }

  // ── Inbox listener ────────────────────────────────────────────────────────

  private async attachInboxListener(sessionId: string): Promise<void> {
    if (!this.firestore) return

    const { collection, query, where, onSnapshot, doc, updateDoc } =
      await import('firebase/firestore')

    const inboxRef = collection(this.firestore, 'sessions', sessionId, 'inbox')
    const unprocessedQuery = query(inboxRef, where('processed', '==', false))

    this.inboxUnsubscribe = onSnapshot(unprocessedQuery, (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== 'added') continue

        const parsed = remoteInboxSchema.safeParse(change.doc.data())
        const msgRef = doc(this.firestore!, 'sessions', sessionId, 'inbox', change.doc.id)

        if (!parsed.success) {
          // Legacy or malformed commands are never executed.
          void updateDoc(msgRef, { processed: true }).catch(() => {})
          continue
        }

        // If first inbox message, mark mobile as connected
        if (!this.state.mobileConnected) {
          this.updateState({ mobileConnected: true })
          void this.writeSessionMetadata({ mobileConnected: true })
        }

        const key = `${sessionId}:${change.doc.id}`
        if (this.inboxInFlight.has(key)) continue
        this.inboxInFlight.add(key)
        void (async () => {
          try {
            if (!this.inboxDelivered.has(key)) {
              await this.processInboxMessage(parsed.data)
              this.inboxDelivered.add(key)
              if (this.inboxDelivered.size > 2000) this.inboxDelivered.delete(this.inboxDelivered.values().next().value!)
            }
            await updateDoc(msgRef, { processed: true })
          } catch { this.emit('delivery-error', { messageId: change.doc.id, error: 'Remote command could not be delivered or acknowledged. It was not marked processed.' }) }
          finally { this.inboxInFlight.delete(key) }
        })()
      }
    })
  }

  // ── Command dispatch ──────────────────────────────────────────────────────

  private async processInboxMessage(msg: SafeRemoteInboxMessage): Promise<void> {
    switch (msg.type) {
      case 'handshake': {
        // Presence signal from mobile app after authentication.
        break
      }
      case 'prompt': {
        const agent = await this.agentManager.get(msg.payload.agentId)
        if (!agent || agent.yolo) throw new Error('Remote agent is unavailable or not permitted')
        const delivered = await this.agentManager.sendInput(msg.payload.agentId, msg.payload.input)
        if (delivered === false) throw new Error('Remote prompt delivery rejected')
        break
      }
    }
  }

  // ── Agent state sync ──────────────────────────────────────────────────────

  private async syncAgentState(): Promise<void> {
    if (!this.firestore || !this.state.sessionId) return

    const { doc, setDoc } = await import('firebase/firestore')
    const agents = (await Promise.resolve(this.agentManager.list())).filter((agent) => !agent.yolo)

    for (const agent of agents) {
      const summary: RemoteAgentSummary = {
        agentId: agent.id,
        name: agent.name,
        status: agent.status,
        model: agent.model,
        provider: agent.provider,
        projectDir: agent.projectDir,
        sessionId: agent.sessionId,
        createdAt: agent.createdAt,
        startedAt: agent.startedAt
      }

      const stateRef = doc(
        this.firestore,
        'sessions',
        this.state.sessionId,
        'state',
        agent.id
      )

      void setDoc(stateRef, summary)
    }

    await this.writeSessionMetadata({
      status: 'active',
      hostConnected: true,
      agentCount: agents.length,
      lastSyncedAt: new Date().toISOString()
    })
  }

  // ── Outbox writing ────────────────────────────────────────────────────────

  private async writeOutbox(
    type: 'output' | 'status' | 'notification' | 'agent_list',
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.firestore || !this.state.sessionId) return

    const { collection, addDoc } = await import('firebase/firestore')
    const outboxRef = collection(
      this.firestore,
      'sessions',
      this.state.sessionId,
      'outbox'
    )

    await addDoc(outboxRef, {
      id: randomUUID().slice(0, 12),
      type,
      payload: fitOutboxPayload(payload),
      timestamp: new Date().toISOString()
    })
  }

  // ── Output batching ───────────────────────────────────────────────────────

  private startOutputFlushing(): void {
    this.flushTimer = setInterval(() => {
      void this.flushOutputBatch()
    }, OUTPUT_FLUSH_INTERVAL_MS)
  }

  private stopOutputFlushing(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private startSessionHeartbeat(): void {
    this.stopSessionHeartbeat()
    void this.writeSessionHeartbeat()
    this.sessionHeartbeatTimer = setInterval(() => {
      void this.writeSessionHeartbeat().catch(() => {
        void this.expireSession()
      })
    }, SESSION_HEARTBEAT_INTERVAL_MS)
  }

  private stopSessionHeartbeat(): void {
    if (this.sessionHeartbeatTimer) {
      clearInterval(this.sessionHeartbeatTimer)
      this.sessionHeartbeatTimer = null
    }
  }

  private startSessionExpiryTimer(expiresAt: string): void {
    this.stopSessionExpiryTimer()
    const delay = Date.parse(expiresAt) - Date.now()
    if (!Number.isFinite(delay) || delay <= 0) {
      void this.expireSession()
      return
    }
    this.sessionExpiryTimer = setTimeout(() => {
      void this.expireSession()
    }, Math.min(delay, 2_147_483_647))
  }

  private stopSessionExpiryTimer(): void {
    if (this.sessionExpiryTimer) {
      clearTimeout(this.sessionExpiryTimer)
      this.sessionExpiryTimer = null
    }
  }

  private async expireSession(): Promise<void> {
    await this.disable()
    this.updateState({ status: 'expired' })
  }

  private async writeSessionHeartbeat(): Promise<void> {
    if (this.state.expiresAt && Date.parse(this.state.expiresAt) <= Date.now()) {
      await this.expireSession()
      return
    }
    await this.writeSessionMetadata({
      status: 'active',
      hostConnected: true,
      mobileConnected: this.state.mobileConnected,
      lastHeartbeatAt: new Date().toISOString()
    })
    await this.syncTaskState()
  }

  private async syncTaskState(): Promise<void> {
    if (!this.firestore || !this.state.sessionId || !this.agentManager.listTasks) return
    const { doc, setDoc } = await import('firebase/firestore')
    const tasks = await this.agentManager.listTasks().catch(() => [])
    for (const task of tasks.slice(0, 30)) {
      await setDoc(doc(this.firestore, 'sessions', this.state.sessionId, 'state', `task-${task.id}`), remoteTaskSummary(task))
    }
  }

  private async flushOutputBatch(): Promise<void> {
    if (this.outputBuffers.size === 0) return

    const batches = new Map(this.outputBuffers)
    this.outputBuffers.clear()

    for (const [agentId, lines] of batches) {
      await this.writeOutbox('output', { agentId, lines })
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  private attachAgentListeners(): void {
    const onOutput = (payload: AgentOutputPayload) => {
      const existing = this.outputBuffers.get(payload.agentId) ?? []
      existing.push(payload.data)
      this.outputBuffers.set(payload.agentId, existing)
    }

    const onStatus = (payload: AgentStatusPayload) => {
      // Update state subcollection
      void this.syncSingleAgentState(payload.agentId)
      // Write status change to outbox
      void this.writeOutbox('status', {
        agentId: payload.agentId,
        status: payload.status,
        sessionId: payload.sessionId ?? null
      })
    }

    this.agentManager.on('output', onOutput)
    this.agentManager.on('status', onStatus)

    this.agentOutputUnsub = () => {
      this.agentManager.removeListener('output', onOutput)
    }
    this.agentStatusUnsub = () => {
      this.agentManager.removeListener('status', onStatus)
    }

    // Notification subscription
    this.notificationUnsub = this.notificationService.subscribe(
      (notification: HydraNotification) => {
        void this.writeOutbox('notification', {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          agentId: notification.agentId ?? null,
          timestamp: notification.timestamp
        })
      }
    )
  }

  private async syncSingleAgentState(agentId: string): Promise<void> {
    if (!this.firestore || !this.state.sessionId) return

    const { doc, setDoc, deleteDoc } = await import('firebase/firestore')
    const agent = await Promise.resolve(this.agentManager.get(agentId))
    const stateRef = doc(
      this.firestore,
      'sessions',
      this.state.sessionId,
      'state',
      agentId
    )

    if (!agent || agent.yolo) {
      // Agent removed
      void deleteDoc(stateRef)
      return
    }

    const summary: RemoteAgentSummary = {
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
      model: agent.model,
      provider: agent.provider,
      projectDir: agent.projectDir,
      sessionId: agent.sessionId,
      createdAt: agent.createdAt,
      startedAt: agent.startedAt
    }

    void setDoc(stateRef, summary)
    const currentAgentCount = (await Promise.resolve(this.agentManager.list())).length
    await this.writeSessionMetadata({
      status: 'active',
      hostConnected: true,
      agentCount: currentAgentCount,
      lastSyncedAt: new Date().toISOString()
    })
  }

  private async writeSessionMetadata(payload: Record<string, unknown>): Promise<void> {
    if (!this.firestore || !this.state.sessionId) return

    const { doc, updateDoc } = await import('firebase/firestore')
    const sessionRef = doc(this.firestore, 'sessions', this.state.sessionId)
    await updateDoc(sessionRef, payload)
  }

  private detachAllListeners(): void {
    this.inboxUnsubscribe?.()
    this.inboxUnsubscribe = null

    this.agentOutputUnsub?.()
    this.agentOutputUnsub = null

    this.agentStatusUnsub?.()
    this.agentStatusUnsub = null

    this.notificationUnsub?.()
    this.notificationUnsub = null
  }

  // ── State management ──────────────────────────────────────────────────────

  private updateState(partial: Partial<RemoteControlState>): void {
    this.state = { ...this.state, ...partial }
    this.emit('state-changed', this.getState())
  }
}
