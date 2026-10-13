import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { CommandAck } from '@hydra/protocol'
import { type AppState, type EngineStore, useEngine } from '../api/store'

export type Route =
  | { view: 'home' }
  | { view: 'project'; projectId: string }
  | { view: 'task'; taskId: string }
  | { view: 'providers' }
  | { view: 'devices' }
  | { view: 'settings' }

export interface Toast { id: number; tone: 'info' | 'bad'; text: string }

/** Host capabilities provided by the desktop shell (absent in a plain browser or on the phone). */
export interface HostBridge {
  pickDirectory?: () => Promise<string | null>
  notify?: (title: string, body: string) => void
}

interface AppContextValue {
  store: EngineStore
  state: AppState
  route: Route
  go: (route: Route) => void
  run: (command: Record<string, unknown>, success?: string) => Promise<CommandAck>
  toasts: Toast[]
  host: HostBridge
  /** True on the phone: desktop-only actions are hidden (the engine refuses them anyway). */
  isRemote: boolean
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ store, host, children }: { store: EngineStore; host: HostBridge; children: ReactNode }) {
  const state = useEngine(store)
  const [route, setRoute] = useState<Route>({ view: 'home' })
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((all) => [...all, { id, tone, text }])
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), tone === 'bad' ? 9000 : 4000)
  }, [])

  const run = useCallback(async (command: Record<string, unknown>, success?: string) => {
    try {
      const ack = await store.transport.execute(command)
      if (!ack.ok) toast('bad', ack.error.message)
      else if (success) toast('info', success)
      return ack
    } catch (error) {
      toast('bad', (error as Error).message)
      return { ok: false as const, error: { code: 'unavailable' as const, message: (error as Error).message } }
    }
  }, [store, toast])

  return <AppContext.Provider value={{ store, state, route, go: setRoute, run, toasts, host, isRemote: store.transport.kind === 'remote' }}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp outside AppProvider')
  return value
}
