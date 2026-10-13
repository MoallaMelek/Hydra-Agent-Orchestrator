import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz' // Crockford base32, lowercase

/** Time-sortable 26-char identifier (48-bit ms timestamp + 80 random bits). */
export function newId(now: number = Date.now()): string {
  let time = ''
  let t = now
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = randomBytes(10)
  let rand = ''
  let acc = 0
  let bits = 0
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      rand += ALPHABET[(acc >> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return time + rand
}

export const shortId = (id: string): string => id.slice(-8)

export const isoNow = (): string => new Date().toISOString()
