import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { checkForUpdate, compareVersions, downloadUpdate, signManifest, UpdateFile, type Fetcher, type UpdateManifest } from './updater.js'
import { cleanup, tempDir } from '../testing/fixtures.js'

const dirs: string[] = []
afterEach(() => cleanup(...dirs.splice(0)))

const secret = ed25519.utils.randomSecretKey()
const publicKeyHex = Buffer.from(ed25519.getPublicKey(secret)).toString('hex')
const secretHex = Buffer.from(secret).toString('hex')
const installer = Buffer.from('pretend installer bytes '.repeat(100))
const sha = createHash('sha256').update(installer).digest('hex')

const manifest = (version = '2.1.0', over: Partial<UpdateManifest['files'][number]> = {}): UpdateManifest => ({
  schema: 1, version, releasedAt: '2026-10-14T00:00:00Z', notes: 'Faster answers',
  files: [{ platform: 'win32-x64', name: 'Hydra-Setup-2.1.0-x64.exe', url: 'https://releases.example.com/Hydra-Setup-2.1.0-x64.exe', sha256: sha, size: installer.length, ...over }]
})
const stream = (bytes: Buffer) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(bytes.subarray(0, 700))); c.enqueue(new Uint8Array(bytes.subarray(700))); c.close() } })
const server = (body: unknown, file = installer): Fetcher => async (url) => url.endsWith('.json')
  ? { ok: true, status: 200, json: async () => body, body: null }
  : { ok: true, status: 200, json: async () => ({}), body: stream(file) }
const config = { manifestUrl: 'https://releases.example.com/manifest.json', publicKeyHex, currentVersion: '2.0.0-alpha.0', platform: 'win32-x64' }

describe('update checks', () => {
  it('does nothing until a release key and address are configured', async () => {
    expect(await checkForUpdate({ ...config, publicKeyHex: null })).toMatchObject({ state: 'not_configured' })
  })

  it('finds a newer, correctly signed release for this platform', async () => {
    const m = manifest()
    const result = await checkForUpdate(config, server({ manifest: m, signature: signManifest(m, secretHex) }))
    expect(result).toMatchObject({ state: 'available', version: '2.1.0' })
  })

  it('rejects a manifest that was altered after signing, or signed by someone else', async () => {
    const m = manifest()
    const signature = signManifest(m, secretHex)
    const tampered = { ...m, files: [{ ...m.files[0]!, url: 'https://evil.example.com/x.exe' }] }
    await expect(checkForUpdate(config, server({ manifest: tampered, signature }))).rejects.toThrow(/not signed by the Hydra publisher/)
    const other = Buffer.from(ed25519.utils.randomSecretKey()).toString('hex')
    await expect(checkForUpdate(config, server({ manifest: m, signature: signManifest(m, other) }))).rejects.toThrow(/not signed/)
  })

  it('refuses plain HTTP, ignores older or equal versions and other platforms', async () => {
    await expect(checkForUpdate({ ...config, manifestUrl: 'http://releases.example.com/manifest.json' })).rejects.toThrow(/HTTPS/)
    const old = manifest('1.9.0')
    expect(await checkForUpdate(config, server({ manifest: old, signature: signManifest(old, secretHex) }))).toMatchObject({ state: 'up_to_date' })
    const mac = manifest('2.1.0', { platform: 'darwin-arm64' })
    expect(await checkForUpdate(config, server({ manifest: mac, signature: signManifest(mac, secretHex) }))).toMatchObject({ state: 'up_to_date' })
  })

  it('orders versions, with pre-releases before releases', () => {
    expect(compareVersions('2.0.0', '2.0.0-alpha.0')).toBe(1)
    expect(compareVersions('2.0.0-alpha.0', '2.0.0-beta.1')).toBe(-1)
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1)
    expect(compareVersions('2.1.0', '2.1.0')).toBe(0)
  })
})

describe('update downloads', () => {
  it('keeps a download only if it matches the signed size and checksum', async () => {
    const dir = tempDir('hydra-update-')
    dirs.push(dir)
    const file = manifest().files[0]!
    const path = await downloadUpdate(file, dir, server(null))
    expect(path).toBe(join(dir, file.name))
    await expect(downloadUpdate(file, dir, server(null, Buffer.from('X'.repeat(installer.length))))).rejects.toThrow(/does not match the signed checksum/)
    await expect(downloadUpdate(file, dir, server(null, Buffer.concat([installer, Buffer.from('extra')])))).rejects.toThrow(/larger than the signed size/)
    // Failed downloads leave nothing behind and never damage the earlier verified file.
    expect(readdirSync(dir)).toEqual([file.name])
    expect(readFileSync(path).equals(installer)).toBe(true)
  })

  it('replaces a link at the final name instead of writing through it (independent review A5-9)', async () => {
    const dir = tempDir('hydra-update-')
    const elsewhere = tempDir('hydra-victim-')
    dirs.push(dir, elsewhere)
    const victim = join(elsewhere, 'important.txt')
    writeFileSync(victim, 'keep me')
    const file = manifest().files[0]!
    symlinkSync(victim, join(dir, file.name), 'file')
    await expect(downloadUpdate(file, dir, server(null, Buffer.from('X'.repeat(installer.length))))).rejects.toThrow(/checksum/)
    expect(readFileSync(victim, 'utf8')).toBe('keep me')
    const path = await downloadUpdate(file, dir, server(null))
    expect(readFileSync(victim, 'utf8')).toBe('keep me')
    expect(readFileSync(path).equals(installer)).toBe(true)
  })

  it('gives up on a server that stops sending, and on a disk that cannot be written (independent review A5-8)', async () => {
    const dir = tempDir('hydra-update-')
    dirs.push(dir)
    const file = manifest().files[0]!
    const stalled: Fetcher = async () => ({ ok: true, status: 200, json: async () => ({}), body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(installer.subarray(0, 10))) } }) })
    await expect(downloadUpdate(file, dir, stalled, 200)).rejects.toThrow(/stalled/)
    expect(readdirSync(dir)).toEqual([])
    // A path that cannot hold files: the folder is a file.
    const blocked = join(dir, 'not-a-folder')
    writeFileSync(blocked, '')
    await expect(downloadUpdate(file, blocked, server(null))).rejects.toThrow()
  })

  it('accepts only plain file names', () => {
    for (const name of ['..', '.', '.hidden', '../x.exe', 'a/b.exe', 'a\\b.exe']) expect(UpdateFile.safeParse({ ...manifest().files[0]!, name }).success).toBe(false)
    expect(UpdateFile.safeParse(manifest().files[0]!).success).toBe(true)
  })
})
