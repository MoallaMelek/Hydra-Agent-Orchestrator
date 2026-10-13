import { BrowserWindow, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { isAllowedRendererNavigation } from './navigation'

type IpcEvent = IpcMainEvent | IpcMainInvokeEvent

export function assertTrustedIpcSender(event: IpcEvent, rendererUrl: string): void {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  const senderFrame = event.senderFrame
  if (
    !senderWindow ||
    senderWindow.isDestroyed() ||
    !senderFrame ||
    senderFrame !== event.sender.mainFrame ||
    !isAllowedRendererNavigation(senderFrame.url, rendererUrl)
  ) {
    throw new Error('Untrusted IPC sender')
  }
}

export function createTrustedIpcMain(ipcMain: IpcMain, rendererUrl: string) {
  return {
    handle<TArgs extends unknown[], TResult>(
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult
    ): void {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedIpcSender(event, rendererUrl)
        return listener(event, ...(args as TArgs))
      })
    },
    on<TArgs extends unknown[]>(
      channel: string,
      listener: (event: IpcMainEvent, ...args: TArgs) => void
    ): void {
      ipcMain.on(channel, (event, ...args) => {
        try {
          assertTrustedIpcSender(event, rendererUrl)
          listener(event, ...(args as TArgs))
        } catch {
          // Fire-and-forget IPC has no rejection channel. Silently drop events
          // from navigated windows, subframes, and unattached webContents.
        }
      })
    }
  }
}
