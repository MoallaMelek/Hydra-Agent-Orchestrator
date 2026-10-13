import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

/**
 * Hydra remote channel v1 (see docs/v2/REMOTE.md). Pure JS, isomorphic: the same
 * code runs in hydrad and in the phone browser (no secure context required).
 */
export const CHANNEL_VERSION = 1
const LABEL = new TextEncoder().encode('hydra-remote-v1')
const KEY_INFO = new TextEncoder().encode('hydra-remote-v1 keys')

export interface KeyPair { publicKey: Uint8Array; secretKey: Uint8Array }

export const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n))

export function generateKeyPair(): KeyPair {
  const secretKey = randomBytes(32)
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) }
}

export function keyPairFromSecret(secretKey: Uint8Array): KeyPair {
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) }
}

// ── encoding ─────────────────────────────────────────────────
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error('invalid hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const utf8 = (text: string) => new TextEncoder().encode(text)
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

// ── pairing offer (QR / link fragment) ──────────────────────
export interface PairingOffer { v: number; e: string; i: string; s: string }

export const encodeOffer = (offer: PairingOffer): string => toBase64Url(utf8(JSON.stringify(offer)))

export function decodeOffer(text: string): PairingOffer {
  const offer = JSON.parse(new TextDecoder().decode(fromBase64Url(text))) as PairingOffer
  if (offer.v !== CHANNEL_VERSION || !/^[0-9a-f]{64}$/.test(offer.e) || !/^[0-9a-f]{64}$/.test(offer.s) || !/^[A-Za-z0-9_-]{8,64}$/.test(offer.i)) {
    throw new Error('Not a valid Hydra pairing link')
  }
  return offer
}

// ── handshake ────────────────────────────────────────────────
export interface ClientHello { t: 'hello'; v: number; d: string; e: string; p: string | null }
export interface ServerHello { t: 'hello'; e: string }

export interface SessionKeys { send: Uint8Array; receive: Uint8Array }

/**
 * Derives per-direction keys. Mixes ephemeral and static DH so that only the
 * holders of the device and engine private keys agree, with forward secrecy.
 */
function deriveKeys(dh: Uint8Array[], clientHello: ClientHello, serverHello: ServerHello, pairingSecret: Uint8Array | null): { c2s: Uint8Array; s2c: Uint8Array } {
  const salt = sha256(concat(LABEL, utf8(JSON.stringify(clientHello)), utf8(JSON.stringify(serverHello)), pairingSecret ?? new Uint8Array()))
  const okm = hkdf(sha256, concat(...dh), salt, KEY_INFO, 64)
  return { c2s: okm.slice(0, 32), s2c: okm.slice(32, 64) }
}

export function clientHandshake(device: KeyPair, enginePublic: Uint8Array, pairingId: string | null) {
  const eph = generateKeyPair()
  const hello: ClientHello = { t: 'hello', v: CHANNEL_VERSION, d: toHex(device.publicKey), e: toHex(eph.publicKey), p: pairingId }
  return {
    hello,
    finish(server: ServerHello, pairingSecret: Uint8Array | null): SessionKeys {
      const serverEph = fromHex(server.e)
      const keys = deriveKeys([
        x25519.getSharedSecret(eph.secretKey, enginePublic),
        x25519.getSharedSecret(device.secretKey, enginePublic),
        x25519.getSharedSecret(eph.secretKey, serverEph),
        x25519.getSharedSecret(device.secretKey, serverEph)
      ], hello, server, pairingSecret)
      return { send: keys.c2s, receive: keys.s2c }
    }
  }
}

export function serverHandshake(engine: KeyPair, hello: ClientHello, pairingSecret: Uint8Array | null): { reply: ServerHello; keys: SessionKeys } {
  if (hello.t !== 'hello' || hello.v !== CHANNEL_VERSION || !/^[0-9a-f]{64}$/.test(hello.d) || !/^[0-9a-f]{64}$/.test(hello.e)) throw new Error('Bad hello')
  const eph = generateKeyPair()
  const reply: ServerHello = { t: 'hello', e: toHex(eph.publicKey) }
  const clientEph = fromHex(hello.e)
  const device = fromHex(hello.d)
  const keys = deriveKeys([
    x25519.getSharedSecret(engine.secretKey, clientEph),
    x25519.getSharedSecret(engine.secretKey, device),
    x25519.getSharedSecret(eph.secretKey, clientEph),
    x25519.getSharedSecret(eph.secretKey, device)
  ], hello, reply, pairingSecret)
  return { reply, keys: { send: keys.s2c, receive: keys.c2s } }
}

// ── framing ──────────────────────────────────────────────────
export interface Frame { t: 'm'; n: number; c: string }

function nonceFor(counter: number): Uint8Array {
  const nonce = new Uint8Array(24)
  new DataView(nonce.buffer).setBigUint64(16, BigInt(counter))
  return nonce
}

/**
 * Encrypted, ordered message stream. Each direction has its own key and a strictly
 * increasing counter: replayed, reordered or tampered frames are rejected.
 */
export class Channel {
  private sendCounter = 0
  private lastReceived = -1

  constructor(private readonly keys: SessionKeys) {}

  seal(message: unknown): Frame {
    const n = this.sendCounter++
    const cipher = xchacha20poly1305(this.keys.send, nonceFor(n))
    return { t: 'm', n, c: toBase64Url(cipher.encrypt(utf8(JSON.stringify(message)))) }
  }

  open<T = unknown>(frame: Frame): T {
    if (frame.t !== 'm' || !Number.isSafeInteger(frame.n) || frame.n <= this.lastReceived) throw new Error('Replayed or out-of-order frame')
    const cipher = xchacha20poly1305(this.keys.receive, nonceFor(frame.n))
    const plain = cipher.decrypt(fromBase64Url(frame.c)) // throws on tampering or wrong keys
    this.lastReceived = frame.n
    return JSON.parse(new TextDecoder().decode(plain)) as T
  }
}

/** Short, human-checkable fingerprint of a public key (shown on both screens). */
export const fingerprint = (publicKey: Uint8Array): string => toHex(sha256(publicKey)).slice(0, 12).toUpperCase().match(/.{4}/g)!.join('-')
