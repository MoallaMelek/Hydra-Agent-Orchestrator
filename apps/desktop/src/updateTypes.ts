export type UpdateAction = 'check' | 'download' | 'install' | 'cancel' | 'auto-check-on' | 'auto-check-off' | 'auto-download-on' | 'auto-download-off'
export interface DesktopUpdateState {
  currentVersion: string
  latestVersion: string | null
  channel: 'stable' | 'preview'
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'preparing' | 'installing' | 'error' | 'not_configured'
  notes: string
  transferred: number
  total: number
  autoCheck: boolean
  autoDownload: boolean
  error: string | null
  recovery: string | null
}
