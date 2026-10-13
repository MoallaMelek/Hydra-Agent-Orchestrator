import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

/** Constant-time bearer token comparison. */
export function bearerMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * DNS-rebinding defence: a malicious web page can make the browser send requests
 * to 127.0.0.1 under its own hostname. Only literal loopback hosts are accepted.
 */
export function hostAllowed(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? '').toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

/** Browsers always send Origin on WebSocket upgrades; only our own origin (or none, for native clients) is accepted. */
export function originAllowed(req: IncomingMessage, port: number, extraOrigins: readonly string[] = []): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraOrigins].includes(origin)
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
}
