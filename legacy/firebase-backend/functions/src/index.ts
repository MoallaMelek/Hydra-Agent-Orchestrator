import * as admin from 'firebase-admin'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'

admin.initializeApp()

const db = admin.firestore()
const auth = admin.auth()

/**
 * Creates a new remote control session.
 *
 * Returns a session document ID plus two custom auth tokens:
 * - hostToken: for the Electron desktop app
 * - mobileToken: for the mobile PWA
 *
 * Tokens carry both a `sessionId` and least-privilege `role` claim.
 */
export const createSession = onCall(async (request) => {
  const hostName = typeof request.data?.hostName === 'string'
    ? request.data.hostName.slice(0, 128)
    : 'Unknown'

  const timeoutMinutes = typeof request.data?.timeoutMinutes === 'number'
    ? Math.min(Math.max(request.data.timeoutMinutes, 30), 1440)
    : 480

  const now = admin.firestore.Timestamp.now()
  const expiresAt = admin.firestore.Timestamp.fromMillis(
    now.toMillis() + timeoutMinutes * 60 * 1000
  )

  // Create session document
  const sessionRef = db.collection('sessions').doc()
  const sessionId = sessionRef.id

  await sessionRef.set({
    createdAt: now,
    expiresAt,
    status: 'active',
    hostName
  })

  // Create custom auth tokens with sessionId claim
  const hostUid = `host-${sessionId}`
  const mobileUid = `mobile-${sessionId}`

  let hostToken: string
  let mobileToken: string

  try {
    hostToken = await auth.createCustomToken(hostUid, { sessionId, role: 'host' })
    mobileToken = await auth.createCustomToken(mobileUid, { sessionId, role: 'mobile' })
  } catch (err) {
    // Clean up session doc on auth failure
    await sessionRef.delete()
    throw new HttpsError(
      'internal',
      'Failed to create auth tokens',
      err instanceof Error ? err.message : String(err)
    )
  }

  return {
    sessionId,
    hostToken,
    mobileToken,
    expiresAt: expiresAt.toDate().toISOString()
  }
})

/** End a session and recursively delete its root and nested documents. */
export const deleteSession = onCall(async (request) => {
  const sessionId = request.auth?.token.sessionId
  const role = request.auth?.token.role
  if (typeof sessionId !== 'string' || role !== 'host') {
    throw new HttpsError('permission-denied', 'Host authorization required')
  }
  if (request.data?.sessionId !== sessionId) {
    throw new HttpsError('permission-denied', 'Session identity mismatch')
  }

  await db.recursiveDelete(db.collection('sessions').doc(sessionId))
  return { deleted: true }
})

/**
 * Scheduled function that runs every hour to delete expired sessions
 * and their subcollections.
 */
export const cleanupExpiredSessions = onSchedule('every 60 minutes', async () => {
  const now = admin.firestore.Timestamp.now()

  const expired = await db
    .collection('sessions')
    .where('expiresAt', '<=', now)
    .get()

  if (expired.empty) return

  await Promise.all(expired.docs.map((doc) => db.recursiveDelete(doc.ref)))
})
