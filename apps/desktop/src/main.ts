import { DesktopUpdates } from './updateController.js'
import { PreferenceStore } from './preferences.js'
import { launchInstallHelper } from './installHelper.js'
import type { UpdateAction } from './updateTypes.js'
import { app, BrowserWindow, dialog, ipcMain, Notification, session, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Keep the renderer profile disposable too when the engine uses a test/dev data root.
if (process.env.HYDRA_DATA_DIR) {
  const profile = join(process.env.HYDRA_DATA_DIR, 'desktop-profile')
  mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
}

/**
 * Hydra desktop shell. It only supervises the engine host (hydrad), opens a
 * locked-down window onto the engine's own UI, and offers a folder picker and
 * notifications. All orchestration lives in hydrad.
 */

const token = randomBytes(32).toString('base64url')
let engine: ChildProcess | null = null
let apiUrl: string | null = null
let engineDataDir: string | null = null
let window: BrowserWindow | null = null
let quitting = false
declare const __HYDRA_UPDATE_CONFIG__: { manifestUrl: string | null; publicKeyHex: string | null }
let desktopUpdates: DesktopUpdates | null = null
let preferences: PreferenceStore | null = null

function resource(...parts: string[]): string {
  // Packaged: <resources>/<parts>; development: the monorepo build outputs.
  if (app.isPackaged) return join(process.resourcesPath, ...parts)
  const repo = join(__dirname, '..', '..', '..')
  return parts[0] === 'hydrad' ? join(repo, 'apps', 'hydrad', 'dist', 'hydrad.mjs') : join(repo, 'packages', 'ui', 'dist')
}

/** Starts hydrad on Electron's embedded Node and resolves with its URL. */
function startEngine(): Promise<string> {
  const entry = app.isPackaged ? resource('hydrad', 'hydrad.mjs') : resource('hydrad')
  const ui = app.isPackaged ? resource('ui') : resource('ui')
  if (!existsSync(entry)) throw new Error(`Engine not found at ${entry}. Run "npm run build" first.`)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, '--static', ui, '--stdin-lifeline'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HYDRA_API_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    engine = child
    let buffer = ''
    let errors = ''
    const timer = setTimeout(() => reject(new Error(`Engine did not start in time. ${errors.slice(-500)}`)), 30_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const line = buffer.split('\n').find((l) => l.includes('"type":"ready"'))
      if (!line) return
      clearTimeout(timer)
      const ready = JSON.parse(line) as { url: string; dataDir: string }
      engineDataDir = ready.dataDir
      resolve(ready.url)
    })
    child.stderr?.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-4000) })
    child.on('exit', (code) => {
      clearTimeout(timer)
      engine = null
      if (!quitting) {
        reject(new Error(`Engine exited (${code}). ${errors.slice(-800)}`))
        if (window) dialog.showErrorBox('Hydra engine stopped', `The engine exited unexpectedly (code ${code}). Hydra will close; your tasks are saved and can be resumed.\n\n${errors.slice(-600)}`)
        app.quit()
      }
    })
  })
}

async function runningTaskCount(): Promise<number> {
  if (!apiUrl) return 0
  try {
    const response = await fetch(`${apiUrl}/api/state`, { headers: { Authorization: `Bearer ${token}` } })
    const state = (await response.json()) as { tasks: Array<{ status: string }> }
    return state.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length
  } catch {
    return 0
  }
}

function createWindow(url: string): void {
  window = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#0b0d12', title: 'Hydra', show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      spellcheck: false,
      additionalArguments: [`--hydra-api=${url}`, `--hydra-token=${token}`]
    }
  })
  const origin = new URL(url).origin
  window.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== origin) event.preventDefault() })
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//.test(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => { if (!process.env.HYDRA_DESKTOP_SMOKE) window?.show() })
  if (process.env.HYDRA_DESKTOP_SMOKE) {
    // Automated smoke test: report what the sandboxed page can and cannot see, then quit.
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void window!.webContents.executeJavaScript(`({
          title: document.title,
          hostKeys: Object.keys(window.hydraHost || {}).sort(),
          hasToken: Boolean(window.hydraHost && window.hydraHost.token),
          nodeRequire: typeof require,
          nodeProcess: typeof process,
          live: document.body.innerText.includes('Live'),
          heading: (document.querySelector('h1') || {}).textContent || null
        })`).then(async (page: unknown) => {
          // Engine-side facts: where data lives, schema state, and provider detection.
          const state = await fetch(`${apiUrl}/api/state`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()) as {
            engineVersion: string; providers: Array<{ id: string; installed: boolean; authenticated: boolean | null; problems: string[] }>
          }
          const report = {
            page, packaged: app.isPackaged, appVersion: app.getVersion(), engineVersion: state.engineVersion, dataDir: engineDataDir,
            databaseExists: engineDataDir ? existsSync(join(engineDataDir, 'hydra.db')) : false,
            providers: state.providers.map((p) => ({ id: p.id, installed: p.installed, authenticated: p.authenticated, problems: p.problems.length }))
          }
          const line = `${JSON.stringify({ type: 'smoke', report })}\n`
          process.stdout.write(line)
          if (process.env.HYDRA_DESKTOP_SMOKE_OUT) writeFileSync(process.env.HYDRA_DESKTOP_SMOKE_OUT, line)
          quitting = true
          app.quit()
        })
      }, 2500)
    })
  }
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    void (async () => {
      try { await window!.webContents.executeJavaScript('window.hydraUi ? window.hydraUi.flush() : Promise.reject(new Error("Interface is not ready to save drafts"))') }
      catch { dialog.showErrorBox('Drafts have not been saved', 'Keep Hydra open. Send, copy or shorten unsent work before closing, then try again.'); return }
      const running = await runningTaskCount()
      if (running) {
        const { response } = await dialog.showMessageBox(window!, {
          type: 'warning', buttons: ['Keep working', 'Quit'], defaultId: 0, cancelId: 0,
          message: `${running} task${running > 1 ? 's are' : ' is'} still running.`,
          detail: 'Quitting stops the agents. The tasks are saved and paused; resume them the next time you open Hydra.'
        })
        if (response === 0) return
      }
      quitting = true
      app.quit()
    })()
  })
  void window.loadURL(`${url}/`)
}

function lockDownSessions(): void {
  // No camera, microphone, notifications-from-web, geolocation, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

function requireDesktop(event: Electron.IpcMainInvokeEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !apiUrl || new URL(event.senderFrame.url).origin !== new URL(apiUrl).origin) throw new Error('Untrusted desktop request')
}
ipcMain.handle('hydra:preferences-read', event => { requireDesktop(event); return preferences!.read() })
ipcMain.handle('hydra:preferences-write', (event, value: unknown) => { requireDesktop(event); preferences!.write(value) })
ipcMain.handle('hydra:update-state', event => { requireDesktop(event); return desktopUpdates!.get() })
ipcMain.handle('hydra:update-action', (event, action: UpdateAction) => {
  requireDesktop(event)
  if (!['check','download','install','cancel','auto-check-on','auto-check-off','auto-download-on','auto-download-off'].includes(action)) throw new Error('Invalid update action')
  return desktopUpdates!.action(action)
})

function initializeDesktopServices(): void {
  const dir = process.env.HYDRA_DATA_DIR ? join(process.env.HYDRA_DATA_DIR, 'desktop') : app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  preferences = new PreferenceStore(dir)
  const command = async (type: string, lease?: string) => {
    if (!apiUrl) throw new Error('Engine is unavailable; restart was refused.')
    const response = await fetch(apiUrl + '/api/commands', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ type, ...(lease ? { lease } : {}) }), signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('Engine did not confirm a safe restart.')
    const ack = await response.json() as { ok: boolean; error?: { message: string }; result?: { backup: string; lease: string } }
    if (!ack.ok) throw new Error(ack.error?.message ?? 'Engine refused restart')
    return ack.result
  }
  desktopUpdates = new DesktopUpdates({
    packaged: app.isPackaged && process.platform === 'win32',
    config: { ...__HYDRA_UPDATE_CONFIG__, currentVersion: app.getVersion(), platform: process.platform + '-' + process.arch, channel: app.getVersion().includes('-') ? 'preview' : 'stable' },
    cache: join(dir, 'updates'), preferencesPath: join(dir, 'updates.json'), journalPath: join(dir, 'update-handoff.json'),
    lock: async locked => {
      if (!window) throw new Error('Cannot lock the interface for restart.')
      await window.webContents.executeJavaScript(`document.querySelector('.shell').inert = ${locked ? 'true' : 'false'}`)
    },
    unsaved: async () => {
      if (!window) throw new Error('Cannot confirm unsaved work; restart refused.')
      return await window.webContents.executeJavaScript(
        '(async () => { if (!window.hydraUi) throw new Error("Interface has not confirmed draft persistence"); await window.hydraUi.flush(); return window.hydraUi.unsaved() + document.querySelectorAll("[data-unsaved=true]").length + [...document.querySelectorAll("textarea")].filter(field => field.value.trim()).length })()'
      ) as number
    },
    prepare: async () => { const result = await command('update.prepare'); if (!result?.backup || !result.lease) throw new Error('No backup and maintenance lease were confirmed'); return result },
    confirm: async lease => { await command('update.confirm', lease) },
    release: async lease => { await command('update.release', lease) },
    launch: async (installer, sha256, backup) => {
      const state = desktopUpdates!.get()
      quitting = true
      desktopUpdates!.stop()
      // The engine has no active tasks and its barrier prevents new work. Wait for
      // its graceful exit before letting the helper replace application binaries.
      if (engine) {
        const child = engine
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Engine did not stop; update postponed.')), 15000)
          child.once('exit', () => { clearTimeout(timer); resolve() })
          child.stdin?.end()
        }).catch(error => { quitting = false; throw error })
      }
      try { await launchInstallHelper(join(dir, 'update-handoff.json'), { installer, executable: process.execPath, sha256, target: state.latestVersion!, previous: app.getVersion(), backup }) }
      catch (error) { app.relaunch(); app.exit(1); throw error }
      app.quit()
    },
    changed: state => { if (window && !window.isDestroyed()) window.webContents.send('hydra:update-changed', state) }
  })
  desktopUpdates.start()
}

ipcMain.handle('hydra:pick-directory', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const result = owner
    ? await dialog.showOpenDialog(owner, { properties: ['openDirectory'], title: 'Choose a project folder' })
    : await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Choose a project folder' })
  return result.canceled ? null : result.filePaths[0] ?? null
})

ipcMain.on('hydra:notify', (_event, payload: unknown) => {
  const { title, body } = (payload ?? {}) as { title?: unknown; body?: unknown }
  if (typeof title === 'string' && typeof body === 'string' && Notification.isSupported()) {
    new Notification({ title: title.slice(0, 120), body: body.slice(0, 400) }).show()
  }
})

if (process.env.HYDRA_DESKTOP_SMOKE) {
  // An unattended smoke run must never hang a CI job.
  setTimeout(() => { process.stderr.write('smoke: timed out\n'); app.exit(2) }, 90_000).unref()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
  void app.whenReady().then(async () => {
    lockDownSessions()
    try {
      apiUrl = await startEngine()
      initializeDesktopServices()
      createWindow(apiUrl)
    } catch (error) {
      quitting = true
      if (process.env.HYDRA_DESKTOP_SMOKE) {
        // Never block an unattended run on a modal dialog.
        const line = `${JSON.stringify({ type: 'smoke', error: (error as Error).message })}\n`
        process.stderr.write(line)
        if (process.env.HYDRA_DESKTOP_SMOKE_OUT) writeFileSync(process.env.HYDRA_DESKTOP_SMOKE_OUT, line)
        app.exit(1)
        return
      }
      dialog.showErrorBox('Hydra could not start', (error as Error).message)
      app.quit()
    }
  })
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => {
    desktopUpdates?.stop()
    // Closing stdin asks hydrad to shut down gracefully (it pauses running tasks).
    // hydrad is not killed when we exit, so it finishes shutting down on its own.
    engine?.stdin?.end()
  })
  app.on('window-all-closed', () => app.quit())
}
