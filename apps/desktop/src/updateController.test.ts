import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signManifest, type UpdateManifest } from '../../../packages/engine/src/update/updater.js'
import { DesktopUpdates, type UpdateHost } from './updateController.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture(over: Partial<UpdateHost> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-desktop-update-')); dirs.push(dir)
  const bytes = Buffer.from('TEST BYTES — never executed')
  const secret = ed25519.utils.randomSecretKey()
  const manifest: UpdateManifest = { schema: 1, version: '2.1.0', releasedAt: '2026-10-16', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+30*86400000).toISOString(), notes: 'Test release', files: [{ name: `Hydra-Setup-2.1.0-${process.arch}.exe`, platform: `win32-${process.arch}`, url: 'https://example.invalid/test.exe', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }] }
  const host: UpdateHost = {
    config: { manifestUrl: 'https://example.invalid/manifest.json', publicKeyHex: Buffer.from(ed25519.getPublicKey(secret)).toString('hex'), currentVersion: '2.0.0', platform: `win32-${process.arch}`, channel: 'stable' },
    cache: join(dir, 'cache'), preferencesPath: join(dir, 'prefs.json'), journalPath: join(dir, 'handoff.json'), packaged: true,
    lock: vi.fn(async () => {}), unsaved: vi.fn(async () => 0), prepare: vi.fn(async () => ({ backup: 'test-backup.db', lease: 'test-lease' })), confirm: vi.fn(async () => {}), release: vi.fn(async () => {}), launch: vi.fn(async () => {}), changed: vi.fn(),
    fetcher: async url => ({ ok: true, status: 200, json: async () => ({ manifest, signature: signManifest(manifest, Buffer.from(secret).toString('hex')) }), body: url.endsWith('.exe') ? new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } }) : null }),
    ...over
  }
  return { controller: new DesktopUpdates(host), host, dir, manifest }
}
describe('desktop update lifecycle (installer launch is a test double)', () => {
  it('reports the checked current version and offers no stale download when already up to date', async () => {
    const { host } = fixture()
    host.config.currentVersion = '2.1.0'
    const controller = new DesktopUpdates(host)
    expect(await controller.action('check')).toMatchObject({ status: 'idle', latestVersion: '2.1.0', error: null })
    expect((await controller.action('download')).error).toContain('Check for an update first')
    expect(host.launch).not.toHaveBeenCalled()
  })
  it('checks a signed version, reports byte progress, prepares a backup, revalidates and hands off only on explicit install', async () => {
    const { controller, host } = fixture()
    expect((await controller.action('check')).status).toBe('available')
    expect(host.launch).not.toHaveBeenCalled()
    const downloaded = await controller.action('download')
    expect(downloaded.status).toBe('downloaded'); expect(downloaded.transferred).toBe(downloaded.total)
    expect(host.launch).not.toHaveBeenCalled()
    expect((await controller.action('install')).status).toBe('installing')
    expect(host.prepare).toHaveBeenCalledOnce(); expect(host.launch).toHaveBeenCalledOnce()
    expect(JSON.parse(readFileSync(host.journalPath, 'utf8'))).toMatchObject({ previous: '2.0.0', target: '2.1.0', backup: 'test-backup.db' })
  })
  it('refuses restart with unsent work or when the engine cannot establish a barrier', async () => {
    const { controller, host } = fixture({ unsaved: async () => 1 })
    await controller.action('check'); await controller.action('download')
    expect((await controller.action('install')).error).toContain('Unsent drafts')
    expect(host.prepare).not.toHaveBeenCalled(); expect(host.launch).not.toHaveBeenCalled()
    expect(host.lock).toHaveBeenLastCalledWith(false)
    host.unsaved = async () => 0
    host.prepare = async () => { throw new Error('Engine unavailable') }
    expect((await controller.action('install')).error).toBe('Engine unavailable')
    expect(host.launch).not.toHaveBeenCalled()
  })
  it('unlocks on lost preparation responses and refuses an expired maintenance lease', async () => {
    const { controller, host } = fixture({ prepare: async () => { throw new Error('Preparation response lost; engine lease expires in 30 seconds') } })
    await controller.action('check'); await controller.action('download')
    expect((await controller.action('install')).error).toContain('response lost')
    expect(host.lock).toHaveBeenLastCalledWith(false)
    host.prepare = async () => ({ backup: 'backup.db', lease: 'expired' })
    host.confirm = async () => { throw new Error('Update lease expired') }
    expect((await controller.action('install')).error).toContain('lease expired')
    expect(host.release).toHaveBeenCalledWith('expired')
    expect(host.launch).not.toHaveBeenCalled()
  })
  it('detects bytes replaced after download and releases the engine barrier', async () => {
    const { controller, host, manifest } = fixture()
    await controller.action('check'); await controller.action('download')
    writeFileSync(join(host.cache, manifest.files[0]!.name), Buffer.alloc(manifest.files[0]!.size, 1))
    expect((await controller.action('install')).error).toContain('checksum changed')
    expect(host.release).toHaveBeenCalledOnce(); expect(host.launch).not.toHaveBeenCalled()
  })
  it('releases maintenance after failed installation handoff and records recovery information', async () => {
    const { controller, host } = fixture({ launch: async () => { throw new Error('Helper could not launch') } })
    await controller.action('check'); await controller.action('download')
    expect((await controller.action('install')).error).toContain('Helper could not launch')
    expect(host.release).toHaveBeenCalledOnce()
    expect(new DesktopUpdates(host).get().recovery).toContain('did not finish')
  })
  it('never contacts releases from an unconfigured development build', async () => {
    const { controller, host } = fixture({ packaged: false })
    expect((await controller.action('check')).status).toBe('not_configured')
    expect(host.launch).not.toHaveBeenCalled()
  })
})
