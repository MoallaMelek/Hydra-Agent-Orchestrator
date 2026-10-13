import type { RemoteTaskSummary } from '../../../shared/remoteTasks'
import { useState, useEffect, useCallback, useRef } from 'react'
import { initializeApp, FirebaseApp } from 'firebase/app'
import { getAuth, getIdTokenResult, signInWithCustomToken, Auth } from 'firebase/auth'
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  Firestore,
  Unsubscribe
} from 'firebase/firestore'
import { parseRemoteConnectionInput, readRemoteLinkFromLocation } from '../../../shared/remoteLink'

type FirebaseEnvKey =
  | 'VITE_FIREBASE_API_KEY'
  | 'VITE_FIREBASE_AUTH_DOMAIN'
  | 'VITE_FIREBASE_PROJECT_ID'
  | 'VITE_FIREBASE_STORAGE_BUCKET'
  | 'VITE_FIREBASE_MESSAGING_SENDER_ID'
  | 'VITE_FIREBASE_APP_ID'

interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId?: string
}

function readRequiredFirebaseEnv(key: FirebaseEnvKey): string {
  const value = import.meta.env[key]?.trim()
  if (value) return value
  throw new Error(
    `Missing required Firebase env var: ${key}. Configure VITE_FIREBASE_* before connecting.`
  )
}

function getFirebaseConfig(): FirebaseConfig {
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID?.trim()

  return {
    apiKey: readRequiredFirebaseEnv('VITE_FIREBASE_API_KEY'),
    authDomain: readRequiredFirebaseEnv('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: readRequiredFirebaseEnv('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: readRequiredFirebaseEnv('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: readRequiredFirebaseEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: readRequiredFirebaseEnv('VITE_FIREBASE_APP_ID'),
    ...(measurementId ? { measurementId } : {})
  }
}

interface AgentSummary {
  agentId: string
  name: string
  status: 'running' | 'idle' | 'errored' | 'starting'
  model: string
  provider: string
  projectDir: string
  sessionId: string | null
  createdAt?: string
  startedAt?: string | null
}

interface OutboxMessage {
  id: string
  type: 'output' | 'status' | 'notification' | 'agent_list'
  payload: Record<string, unknown>
  timestamp: string
}

type InboxMessageType = 'handshake' | 'prompt'

const LAST_SESSION_STORAGE_KEY = 'hydra.remote.lastSessionQrPayload'
const REMOTE_SESSION_STALE_MS = 45_000

interface RemoteSessionRecord {
  status?: string
  expiresAt?: unknown
  hostConnected?: boolean
  lastHeartbeatAt?: unknown
}

function readStoredSessionPayload(): string | null {
  try {
    return window.localStorage.getItem(LAST_SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredSessionPayload(payload: string): void {
  try {
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, payload)
  } catch {
    // Ignore storage failures on restricted/private contexts.
  }
}

function clearStoredSessionPayload(): void {
  try {
    window.localStorage.removeItem(LAST_SESSION_STORAGE_KEY)
  } catch {
    // Ignore storage failures on restricted/private contexts.
  }
}

export function useRemoteSession() {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [restoringSession, setRestoringSession] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [tasks, setTasks] = useState<RemoteTaskSummary[]>([])
  const [messages, setMessages] = useState<OutboxMessage[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)

  const firebaseAppRef = useRef<FirebaseApp | null>(null)
  const firestoreRef = useRef<Firestore | null>(null)
  const authRef = useRef<Auth | null>(null)
  const unsubscribesRef = useRef<Unsubscribe[]>([])
  const sessionMetaUnsubscribeRef = useRef<Unsubscribe | null>(null)
  const connectInFlightRef = useRef(false)
  const autoReconnectTriedRef = useRef(false)

  const sendInboxMessage = useCallback(
    async (type: InboxMessageType, payload: Record<string, unknown>) => {
      if (!firestoreRef.current || !sessionId) return

      const inboxRef = collection(firestoreRef.current, 'sessions', sessionId, 'inbox')
      await addDoc(inboxRef, {
        type,
        payload,
        timestamp: new Date().toISOString(),
        processed: false
      })
    },
    [sessionId]
  )

  const disconnectInternal = useCallback((nextError: string | null) => {
    sessionMetaUnsubscribeRef.current?.()
    sessionMetaUnsubscribeRef.current = null

    for (const unsub of unsubscribesRef.current) {
      unsub()
    }
    unsubscribesRef.current = []

    setConnected(false)
    setSessionId(null)
    setAgents([])
    setTasks([])
    setMessages([])
    setError(nextError)
    clearStoredSessionPayload()
  }, [])

  const connect = useCallback(async (qrData: string): Promise<boolean> => {
    if (connectInFlightRef.current) return false
    connectInFlightRef.current = true
    setConnecting(true)
    setError(null)

    try {
      const payload = parseRemoteConnectionInput(qrData, window.location.origin)

      // Use projectId from QR if different from configured env project.
      const config = { ...getFirebaseConfig() }
      if (payload.projectId) {
        config.projectId = payload.projectId
      }

      // Init Firebase
      if (!firebaseAppRef.current) {
        firebaseAppRef.current = initializeApp(config, 'hydra-remote-mobile')
      }

      const auth = getAuth(firebaseAppRef.current)
      const firestore = getFirestore(firebaseAppRef.current)
      authRef.current = auth
      firestoreRef.current = firestore

      // Auth with mobile token
      const credential = await signInWithCustomToken(auth, payload.mobileToken)
      const token = await getIdTokenResult(credential.user)
      if (token.claims.sessionId !== payload.sessionId || token.claims.role !== 'mobile') {
        throw new Error('Pairing credential is not authorized for mobile access.')
      }
      const sessionRef = doc(firestore, 'sessions', payload.sessionId)
      const sessionSnapshot = await getDoc(sessionRef)
      if (!sessionSnapshot.exists()) {
        throw new Error('Remote session was not found. Scan the latest desktop QR code.')
      }

      const sessionRecord = sessionSnapshot.data() as RemoteSessionRecord
      if (!isRemoteSessionActive(sessionRecord)) {
        throw new Error('Remote session is stale or disconnected. Scan the latest desktop QR code.')
      }

      setSessionId(payload.sessionId)
      // Signal desktop that mobile has successfully connected.
      const inboxRef = collection(firestore, 'sessions', payload.sessionId, 'inbox')
      await addDoc(inboxRef, {
        type: 'handshake',
        payload: { source: 'hydra-remote-mobile' },
        timestamp: new Date().toISOString(),
        processed: false
      })

      for (const unsub of unsubscribesRef.current) {
        unsub()
      }
      unsubscribesRef.current = []

      // Listen to agent state
      const stateRef = collection(firestore, 'sessions', payload.sessionId, 'state')
      const stateUnsub = onSnapshot(stateRef, (snapshot) => {
        const agentList: AgentSummary[] = []
        const taskList: RemoteTaskSummary[] = []
        snapshot.forEach((doc) => {
          const data = doc.data()
          if (data.kind === 'task') {
            if (typeof data.taskId === 'string' && typeof data.title === 'string' && typeof data.phase === 'string' && typeof data.summary === 'string' && Array.isArray(data.providers)) taskList.push(data as RemoteTaskSummary)
          } else if (typeof data.agentId === 'string') agentList.push(data as AgentSummary)
        })
        setAgents(agentList)
        setTasks(taskList.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)))
      })

      // Listen to outbox (latest 100 messages)
      const outboxRef = collection(firestore, 'sessions', payload.sessionId, 'outbox')
      const outboxQuery = query(outboxRef, orderBy('timestamp', 'desc'), limit(100))
      const outboxUnsub = onSnapshot(outboxQuery, (snapshot) => {
        const msgs: OutboxMessage[] = []
        snapshot.forEach((doc) => {
          msgs.push(doc.data() as OutboxMessage)
        })
        setMessages(msgs.reverse())
      })

      sessionMetaUnsubscribeRef.current?.()
      sessionMetaUnsubscribeRef.current = onSnapshot(sessionRef, (snapshot) => {
        if (!snapshot.exists()) {
          disconnectInternal('Remote session ended on desktop. Scan again.')
          return
        }

        const data = snapshot.data() as RemoteSessionRecord
        if (!isRemoteSessionActive(data)) {
          disconnectInternal('Remote session expired or host disconnected. Scan again.')
        }
      })

      unsubscribesRef.current = [stateUnsub, outboxUnsub]
      setConnected(true)
      writeStoredSessionPayload(qrData)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      return false
    } finally {
      connectInFlightRef.current = false
      setConnecting(false)
    }
  }, [disconnectInternal])

  const sendCommand = useCallback(
    async (
      type: 'prompt',
      payload: Record<string, unknown>
    ) => {
      await sendInboxMessage(type, payload)
    },
    [sendInboxMessage]
  )

  const disconnect = useCallback(() => {
    disconnectInternal(null)
  }, [disconnectInternal])

  useEffect(() => {
    // Attempt seamless reconnect after relaunch to avoid requiring a fresh QR scan.
    if (autoReconnectTriedRef.current) return
    autoReconnectTriedRef.current = true

    const deepLinkPayload = readRemoteLinkFromLocation(window.location.href)
    const savedPayload = deepLinkPayload ?? readStoredSessionPayload()
    if (!savedPayload) {
      setRestoringSession(false)
      return
    }

    void (async () => {
      const connectedToSavedSession = await connect(savedPayload)
      if (!connectedToSavedSession) {
        clearStoredSessionPayload()
        // Failed auto-reconnect should silently fall back to scanner UI.
        setError(null)
      } else if (deepLinkPayload) {
        // The fragment contains the temporary session credential. Remove it
        // from the address bar after authentication; localStorage handles reloads.
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      }
      setRestoringSession(false)
    })()
  }, [connect])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnectInternal(null)
    }
  }, [disconnectInternal])

  return {
    connected,
    connecting,
    restoringSession,
    error,
    agents,
    tasks,
    messages,
    sessionId,
    connect,
    sendCommand,
    disconnect
  }
}

function isRemoteSessionActive(record: RemoteSessionRecord | null | undefined): boolean {
  if (!record) return false
  if (typeof record.status === 'string' && record.status !== 'active') return false
  if (record.hostConnected === false) return false

  const expiresAtMs = parseIsoTimestamp(record.expiresAt)
  if (expiresAtMs !== null && expiresAtMs <= Date.now()) return false

  const heartbeatMs = parseIsoTimestamp(record.lastHeartbeatAt)
  if (heartbeatMs !== null && Date.now() - heartbeatMs > REMOTE_SESSION_STALE_MS) {
    return false
  }

  return true
}

function parseIsoTimestamp(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis
    if (typeof toMillis === 'function') {
      const parsed = toMillis.call(value)
      return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
    }
  }
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
