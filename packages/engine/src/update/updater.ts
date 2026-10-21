import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { open, rename, rm, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { ed25519 } from '@noble/curves/ed25519.js'
import { z } from 'zod'

/**
 * Update foundation. A release is described by a manifest signed with the owner's
 * Ed25519 key; the app embeds only the public key. Nothing is checked unless the
 * person asks (no background network calls), nothing is installed without their
 * click, and every download is checked against the signed size and SHA-256.
 *
 * Blocked on the owner: a signing key pair (tools/release-sign.mjs creates one),
 * a place to host the manifest and installers, and OS code signing.
 */

export const UpdateFile = z.object({
  /** process.platform + '-' + process.arch, e.g. "win32-x64". */
  platform: z.string().regex(/^[a-z0-9]+-[a-z0-9]+$/),
  // A plain file name: no path parts and no leading dot (so never "." or "..").
  name: z.string().regex(/^[\w-][\w.-]*$/).max(200),
  url: z.string().url().max(2000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.number().int().positive()
})
export const UpdateManifest = z.object({
  schema: z.literal(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
  releasedAt: z.string(),
  notes: z.string().max(10_000),
  files: z.array(UpdateFile).min(1).max(20)
})
export type UpdateManifest = z.infer<typeof UpdateManifest>
export const SignedManifest = z.object({ manifest: UpdateManifest, signature: z.string().regex(/^[0-9a-f]{128}$/) })

/** Deterministic JSON (sorted keys) so the signature covers exactly what was signed. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const unhex = (text: string) => new Uint8Array(Buffer.from(text, 'hex'))

export function signManifest(manifest: UpdateManifest, secretKeyHex: string): string {
  return hex(ed25519.sign(new TextEncoder().encode(canonical(manifest)), unhex(secretKeyHex)))
}

export function verifyManifest(signed: unknown, publicKeyHex: string): UpdateManifest {
  const parsed = SignedManifest.safeParse(signed)
  if (!parsed.success) throw new Error('The update description is malformed.')
  const ok = ed25519.verify(unhex(parsed.data.signature), new TextEncoder().encode(canonical(parsed.data.manifest)), unhex(publicKeyHex))
  if (!ok) throw new Error('The update is not signed by the Hydra publisher. It was ignored.')
  return parsed.data.manifest
}

/** -1, 0 or 1. Pre-releases sort before the release with the same numbers. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string): [string, string] => {
    const plain = version.split('+', 1)[0]!
    const dash = plain.indexOf('-')
    return dash < 0 ? [plain, ''] : [plain.slice(0, dash), plain.slice(dash + 1)]
  }
  const [ma, pa] = parts(a)
  const [mb, pb] = parts(b)
  const na = ma.split('.').map((part) => BigInt(part))
  const nb = mb.split('.').map((part) => BigInt(part))
  for (let i = 0; i < 3; i++) if ((na[i] ?? 0n) !== (nb[i] ?? 0n)) return (na[i] ?? 0n) < (nb[i] ?? 0n) ? -1 : 1
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  const ia = pa.split('.'), ib = pb.split('.')
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    const x = ia[i], y = ib[i]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y)
    if (xn && yn) {
      if (BigInt(x) === BigInt(y)) continue
      return BigInt(x) < BigInt(y) ? -1 : 1
    }
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

export interface UpdateConfig { manifestUrl: string | null; publicKeyHex: string | null; currentVersion: string; platform: string }
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; body: ReadableStream<Uint8Array> | null }>

export type UpdateCheck =
  | { state: 'not_configured'; reason: string }
  | { state: 'up_to_date'; version: string }
  | { state: 'available'; version: string; notes: string; file: z.infer<typeof UpdateFile> }

/** Asks the release server, verifies the signature, and says whether a newer version exists for this platform. */
export async function checkForUpdate(config: UpdateConfig, fetcher: Fetcher = fetch as unknown as Fetcher, timeoutMs = 60_000): Promise<UpdateCheck> {
  if (!config.manifestUrl || !config.publicKeyHex) return { state: 'not_configured', reason: 'Updates are not set up in this build yet (no release key or release address).' }
  if (!/^https:\/\//.test(config.manifestUrl)) throw new Error('Updates are only fetched over HTTPS.')
  const response = await withDeadline(fetcher(config.manifestUrl), timeoutMs, 'The update server did not answer.')
  if (!response.ok) throw new Error(`The update server answered ${response.status}.`)
  const manifest = verifyManifest(await withDeadline(response.json(), timeoutMs, 'The update description stalled.'), config.publicKeyHex)
  if (compareVersions(manifest.version, config.currentVersion) <= 0) return { state: 'up_to_date', version: config.currentVersion }
  const file = manifest.files.find((f) => f.platform === config.platform)
  if (!file) return { state: 'up_to_date', version: config.currentVersion }
  if (!/^https:\/\//.test(file.url)) throw new Error('Updates are only downloaded over HTTPS.')
  return { state: 'available', version: manifest.version, notes: manifest.notes, file }
}

/**
 * Downloads an installer into `dir` and keeps it only if its size and SHA-256 match the
 * signed manifest. Returns the file path; nothing is run.
 *
 * The bytes go to a new file with an unpredictable name, created exclusively (an existing
 * file or link at that name makes it fail rather than be written through). Only a
 * verified, closed file is renamed into place, which replaces a link at the final name
 * instead of following it. A stalled server or a failing disk ends the download.
 */
export async function downloadUpdate(file: z.infer<typeof UpdateFile>, dir: string, fetcher: Fetcher = fetch as unknown as Fetcher, stallMs = 60_000): Promise<string> {
  if (!/^https:\/\//.test(file.url)) throw new Error('Updates are only downloaded over HTTPS.')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, file.name)
  const response = await withDeadline(fetcher(file.url), stallMs, 'The update server did not answer.')
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`)
  const temp = join(dir, `.${file.name}.${randomBytes(8).toString('hex')}.part`)
  const reader = response.body.getReader()
  let handle: FileHandle | null = null
  try {
    handle = await open(temp, 'wx', 0o600)
    const hash = createHash('sha256')
    let size = 0
    for (;;) {
      const { done, value } = await withDeadline(reader.read(), stallMs, 'The download stalled.')
      if (done) break
      size += value.byteLength
      if (size > file.size) throw new Error('The download is larger than the signed size.')
      hash.update(value)
      await handle.write(value) // rejects on a disk error instead of waiting forever
    }
    await handle.close()
    handle = null
    if (size !== file.size || hash.digest('hex') !== file.sha256) throw new Error('The download does not match the signed checksum. It was deleted.')
    await rename(temp, target)
    return target
  } catch (error) {
    void reader.cancel().catch(() => { /* already finished */ })
    await handle?.close().catch(() => { /* already failing */ })
    await rm(temp, { force: true })
    throw error
  }
}

function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}
