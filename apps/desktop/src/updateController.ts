import { secureUpdateFetch } from './updateFetch.js'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkForUpdate, downloadUpdate, type Fetcher, type UpdateCheck, type UpdateConfig } from '../../../packages/engine/src/update/updater.js'
import type { DesktopUpdateState, UpdateAction } from './updateTypes.js'

export interface UpdateHost {
  config: UpdateConfig
  packaged: boolean
  cache: string
  preferencesPath: string
  journalPath: string
  unsaved(): Promise<number>
  lock(locked: boolean): Promise<void>
  prepare(): Promise<{ backup: string; lease: string }>
  confirm(lease: string): Promise<void>
  release(lease: string): Promise<void>
  launch(installer: string, sha256: string, backup: string): Promise<void>
  changed(state: DesktopUpdateState): void
  fetcher?: Fetcher
}

export class DesktopUpdates {
  private state: DesktopUpdateState
  private available: Extract<UpdateCheck, { state: 'available' }> | null = null
  private installer: string | null = null
  private busy = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private abort: AbortController | null = null
  constructor(private readonly host: UpdateHost) {
    let settings = { autoCheck: true, autoDownload: false }
    try { const saved = JSON.parse(readFileSync(host.preferencesPath, 'utf8')); settings = { autoCheck: saved.autoCheck !== false, autoDownload: saved.autoDownload === true } } catch { /* defaults */ }
    let recovery: string | null = null
    try {
      let previous = JSON.parse(readFileSync(host.journalPath, 'utf8').replace(/^\uFEFF/, '')) as { target: string; phase: string; backup?: string; error?: string; attemptJournal?: string }
      if (previous.attemptJournal && /^[A-Za-z0-9_-]+\.[0-9a-f-]{36}\.json$/.test(previous.attemptJournal)) previous = JSON.parse(readFileSync(join(dirname(host.journalPath), previous.attemptJournal), 'utf8').replace(/^\uFEFF/, '')) as typeof previous
      recovery = previous.target === host.config.currentVersion && previous.phase === 'launched' ? `Running updated version ${previous.target}. A pre-update database backup is available.` : `Previous update did not finish (${previous.phase}). ${previous.error ?? ''} ${previous.backup ? `Backup: ${previous.backup}` : 'Retry the download or use the last trusted installer.'}`
    } catch { /* no previous handoff */ }
    this.state = { currentVersion: host.config.currentVersion, latestVersion: null, channel: host.config.currentVersion.includes('-') ? 'preview' : 'stable', status: 'idle', notes: '', transferred: 0, total: 0, ...settings, error: null, recovery }
  }
  get(): DesktopUpdateState { return { ...this.state } }
  start(): void {
    this.stop()
    if (!this.host.packaged || !this.state.autoCheck) return
    // No startup-path requests. One delayed check, then one check every six hours.
    this.timer = setTimeout(() => { void this.action('check').finally(() => this.schedule()) }, 30_000)
    this.timer.unref()
  }
  private schedule(): void {
    if (!this.state.autoCheck) return
    this.timer = setTimeout(() => { void this.action('check').finally(() => this.schedule()) }, 6 * 60 * 60_000)
    this.timer.unref()
  }
  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null }
  private patch(next: Partial<DesktopUpdateState>): void { this.state = { ...this.state, ...next }; this.host.changed(this.get()) }
  async action(action: UpdateAction): Promise<DesktopUpdateState> {
    if (action === 'cancel') { this.abort?.abort(); return this.get() }
    if (action.startsWith('auto-')) {
      const autoCheck = action.startsWith('auto-check') ? action.endsWith('-on') : this.state.autoCheck
      const autoDownload = action.startsWith('auto-download') ? action.endsWith('-on') : this.state.autoDownload
      writeFileSync(this.host.preferencesPath, JSON.stringify({ autoCheck, autoDownload }), { mode: 0o600 })
      this.patch({ autoCheck, autoDownload }); this.start(); return this.get()
    }
    if (this.busy) return this.get()
    this.busy = true
    try {
      if (!this.host.packaged || !this.host.config.publicKeyHex || !this.host.config.manifestUrl) {
        this.patch({ status: 'not_configured', error: 'This build has no trusted release configuration. Install one publisher-approved update-capable build once. No update was downloaded or installed.' })
        return this.get()
      }
      if (action === 'check') {
        this.patch({ status: 'checking', error: null })
        const result = await checkForUpdate(this.host.config, (this.host.fetcher ?? secureUpdateFetch))
        if (result.state !== 'available') {
          this.available = null; this.installer = null
          this.patch({ status: result.state === 'up_to_date' ? 'idle' : 'not_configured', latestVersion: result.state === 'up_to_date' ? result.version : null, notes: '', transferred: 0, total: 0, error: result.state === 'not_configured' ? result.reason : null })
          return this.get()
        }
        if (!result.file.name.endsWith('.exe') || !result.file.name.includes(`-${process.arch}.exe`)) throw new Error('The signed package is incompatible with this Windows installation.')
        this.available = result
        this.patch({ status: 'available', latestVersion: result.version, notes: result.notes, transferred: 0, total: result.file.size })
        if (this.state.autoDownload) await this.download()
      } else if (action === 'download') await this.download()
      else if (action === 'install') await this.install()
    } catch (e) { this.patch({ status: 'error', error: (e as Error).message }) }
    finally { this.busy = false }
    return this.get()
  }
  private async download(): Promise<void> {
    if (!this.available) throw new Error('Check for an update first.')
    this.abort = new AbortController()
    this.patch({ status: 'downloading', transferred: 0, error: null })
    try {
      this.installer = await downloadUpdate(this.available.file, this.host.cache, (this.host.fetcher ?? secureUpdateFetch), 60_000, {
        signal: this.abort.signal,
        onProgress: transferred => this.patch({ transferred })
      })
      this.patch({ status: 'downloaded', transferred: this.available.file.size })
    } finally { this.abort = null }
  }
  private async install(): Promise<void> {
    if (!this.installer || !this.available || !existsSync(this.installer)) throw new Error('Download a verified update first.')
    this.patch({ status: 'preparing', error: null })
    let prepared: { backup: string; lease: string } | null = null
    try {
      await this.host.lock(true)
      if (await this.host.unsaved()) throw new Error('Unsent drafts or unsaved work are present. Send, copy or explicitly discard them before restarting. The update can wait.')
      prepared = await this.host.prepare() // Bounded engine lease blocks new work, including remote commands.
      const stat = lstatSync(this.installer)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== this.available.file.size) throw new Error('The downloaded installer changed. Download it again.')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(this.installer)) hash.update(chunk)
      if (hash.digest('hex') !== this.available.file.sha256) throw new Error('The downloaded installer checksum changed. Installation was refused.')
      await this.host.confirm(prepared.lease)
      if (await this.host.unsaved()) throw new Error('Unsaved work was detected before restart. Update postponed.')
      writeFileSync(this.host.journalPath, JSON.stringify({ target: this.available.version, previous: this.state.currentVersion, phase: 'prepared', backup: prepared.backup }), { mode: 0o600 })
      await this.host.launch(this.installer, this.available.file.sha256, prepared.backup)
      this.patch({ status: 'installing' })
    } catch (e) {
      if (prepared) await this.host.release(prepared.lease).catch(() => {})
      await this.host.lock(false).catch(() => {})
      throw e
    }
  }
}
