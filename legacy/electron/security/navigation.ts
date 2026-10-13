import type { WebContents } from 'electron'

const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:'])

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

export function isAllowedRendererNavigation(targetUrl: string, rendererUrl: string): boolean {
  try {
    const target = new URL(targetUrl)
    const renderer = new URL(rendererUrl)

    if (renderer.protocol === 'file:') {
      return target.protocol === 'file:' && target.pathname === renderer.pathname
    }
    return target.origin === renderer.origin
  } catch {
    return false
  }
}

export function lockDownNavigation(
  webContents: WebContents,
  rendererUrl: string,
  openExternal: (url: string) => Promise<unknown>
): void {
  const blockUnexpectedNavigation = (event: Electron.Event, url: string): void => {
    if (!isAllowedRendererNavigation(url, rendererUrl)) event.preventDefault()
  }

  webContents.on('will-navigate', blockUnexpectedNavigation)
  webContents.on('will-redirect', blockUnexpectedNavigation)
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void openExternal(url)
    return { action: 'deny' }
  })
}
