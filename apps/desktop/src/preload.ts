import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only bridge between the page and the desktop: the engine address and
 * session token (generated per launch), a folder picker and notifications.
 * No Node APIs are exposed.
 */
const arg = (name: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''

import type { DesktopUpdateState, UpdateAction } from './updateTypes.js'

contextBridge.exposeInMainWorld('hydraHost', {
  readPreferences: () => ipcRenderer.invoke('hydra:preferences-read'),
  writePreferences: (value: unknown) => ipcRenderer.invoke('hydra:preferences-write', value),
  updates: {
    state: () => ipcRenderer.invoke('hydra:update-state'),
    action: (action: UpdateAction) => ipcRenderer.invoke('hydra:update-action', action),
    subscribe: (listener: (state: DesktopUpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => listener(state)
      ipcRenderer.on('hydra:update-changed', handler)
      return () => ipcRenderer.removeListener('hydra:update-changed', handler)
    }
  },
  apiUrl: arg('hydra-api'),
  token: arg('hydra-token'),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('hydra:pick-directory'),
  notify: (title: string, body: string): void => ipcRenderer.send('hydra:notify', { title, body })
})
