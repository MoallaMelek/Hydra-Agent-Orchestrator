import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only bridge between the page and the desktop: the engine address and
 * session token (generated per launch), a folder picker and notifications.
 * No Node APIs are exposed.
 */
const arg = (name: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''

contextBridge.exposeInMainWorld('hydraHost', {
  apiUrl: arg('hydra-api'),
  token: arg('hydra-token'),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('hydra:pick-directory'),
  notify: (title: string, body: string): void => ipcRenderer.send('hydra:notify', { title, body })
})
