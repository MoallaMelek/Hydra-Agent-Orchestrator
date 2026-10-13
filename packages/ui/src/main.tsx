import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/tokens.css'
import './design/base.css'
import './design/components.css'
import './views/app.css'
import { HttpTransport } from './api/transport'
import { EngineStore } from './api/store'
import { AppProvider, type HostBridge } from './app/context'
import { Shell } from './app/Shell'

/** Exposed by the Electron preload script; absent in a plain browser. */
declare global {
  interface Window { hydraHost?: HostBridge & { apiUrl: string; token: string } }
}

const TOKEN_KEY = 'hydra.session'

/**
 * The API token comes from the desktop shell, or once from the URL fragment
 * (never sent to any server), after which it lives only in sessionStorage.
 */
function connection(): { apiUrl: string; token: string } | null {
  if (window.hydraHost) return { apiUrl: window.hydraHost.apiUrl, token: window.hydraHost.token }
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const fromHash = fragment.get('token')
  if (fromHash) {
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: fromHash, api: fragment.get('api') })) } catch { /* private mode */ }
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  let saved: { token?: string; api?: string | null } = {}
  try { saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? '{}') as typeof saved } catch { /* none */ }
  const token = fromHash ?? saved.token
  if (!token) return null
  return { apiUrl: (fragment.get('api') ?? saved.api ?? window.location.origin).replace(/\/$/, ''), token }
}

const root = createRoot(document.getElementById('root')!)
const conn = connection()
if (!conn) {
  root.render(<div className="hx-empty" style={{ height: '100%' }}><h3>Open Hydra from the desktop app</h3><p className="muted">This page needs a session from a running Hydra engine.</p></div>)
} else {
  const store = new EngineStore(new HttpTransport(conn.apiUrl, conn.token))
  void store.start()
  root.render(
    <StrictMode>
      <AppProvider store={store} host={window.hydraHost ?? {}}>
        <Shell />
      </AppProvider>
    </StrictMode>
  )
}
