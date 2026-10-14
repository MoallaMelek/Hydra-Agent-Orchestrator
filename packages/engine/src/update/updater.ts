import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, rmSync } from 'node:fs'
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
  name: z.string().regex(/^[\w.-]+$/).max(200),
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
  const [ma, pa = ''] = a.split('-', 2) as [string, string?]
  const [mb, pb = ''] = b.split('-', 2) as [string, string?]
  const na = ma.split('.').map(Number)
  const nb = mb.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((na[i] ?? 0) !== (nb[i] ?? 0)) return (na[i] ?? 0) < (nb[i] ?? 0) ? -1 : 1
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa < pb ? -1 : 1
}

export interface UpdateConfig { manifestUrl: string | null; publicKeyHex: string | null; currentVersion: string; platform: string }
export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; body: ReadableStream<Uint8Array> | null }>

export type UpdateCheck =
  | { state: 'not_configured'; reason: string }
  | { state: 'up_to_date'; version: string }
  | { state: 'available'; version: string; notes: string; file: z.infer<typeof UpdateFile> }

/** Asks the release server, verifies the signature, and says whether a newer version exists for this platform. */
export async function checkForUpdate(config: UpdateConfig, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<UpdateCheck> {
  if (!config.manifestUrl || !config.publicKeyHex) return { state: 'not_configured', reason: 'Updates are not set up in this build yet (no release key or release address).' }
  if (!/^https:\/\//.test(config.manifestUrl)) throw new Error('Updates are only fetched over HTTPS.')
  const response = await fetcher(config.manifestUrl)
  if (!response.ok) throw new Error(`The update server answered ${response.status}.`)
  const manifest = verifyManifest(await response.json(), config.publicKeyHex)
  if (compareVersions(manifest.version, config.currentVersion) <= 0) return { state: 'up_to_date', version: config.currentVersion }
  const file = manifest.files.find((f) => f.platform === config.platform)
  if (!file) return { state: 'up_to_date', version: config.currentVersion }
  if (!/^https:\/\//.test(file.url)) throw new Error('Updates are only downloaded over HTTPS.')
  return { state: 'available', version: manifest.version, notes: manifest.notes, file }
}

/**
 * Downloads an installer into `dir` and keeps it only if its size and SHA-256 match the
 * signed manifest. Returns the file path; nothing is run.
 */
export async function downloadUpdate(file: z.infer<typeof UpdateFile>, dir: string, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<string> {
  if (!/^https:\/\//.test(file.url)) throw new Error('Updates are only downloaded over HTTPS.')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, file.name)
  const response = await fetcher(file.url)
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status}).`)
  const hash = createHash('sha256')
  let size = 0
  const out = createWriteStream(target, { mode: 0o600 })
  const closed = new Promise<void>((resolve) => out.once('close', () => resolve()))
  out.on('error', () => { /* reported through the checks below */ })
  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > file.size) throw new Error('The download is larger than the signed size.')
      hash.update(value)
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
    if (size !== file.size || hash.digest('hex') !== file.sha256) throw new Error('The download does not match the signed checksum. It was deleted.')
    return target
  } catch (error) {
    out.destroy()
    await closed // only delete once the file is closed
    rmSync(target, { force: true })
    throw error
  }
}
