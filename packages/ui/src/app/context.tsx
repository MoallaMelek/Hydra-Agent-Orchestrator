import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
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
  route: Route
  go: (route: Route) => void
  run: (command: Record<string, unknown>, success?: string) => Promise<CommandAck>
  host: HostBridge
  /** True on the phone: desktop-only actions are hidden (the engine refuses them anyway). */
  isRemote: boolean
}

/** Toasts live outside the main context so showing one does not re-render the app. */
class ToastStore {
  private list: Toast[] = []
  private readonly listeners = new Set<() => void>()
  get = () => this.list
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  push(tone: Toast['tone'], text: string): void {
    const id = Date.now() + Math.random()
    this.list = [...this.list, { id, tone, text }].slice(-4)
    this.emit()
    setTimeout(() => { this.list = this.list.filter((t) => t.id !== id); this.emit() }, tone === 'bad' ? 9000 : 4000)
  }
  private emit() { for (const l of this.listeners) l() }
}

const AppContext = createContext<AppContextValue | null>(null)
const ToastContext = createContext<ToastStore | null>(null)

export function AppProvider({ store, host, children }: { store: EngineStore; host: HostBridge; children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ view: 'home' })
  const [toasts] = useState(() => new ToastStore())

  const run = useCallback(async (command: Record<string, unknown>, success?: string) => {
    try {
      const ack = await store.transport.execute(command)
      if (!ack.ok) toasts.push('bad', ack.error.message)
      else if (success) toasts.push('info', success)
      return ack
    } catch (error) {
      toasts.push('bad', (error as Error).message)
      return { ok: false as const, error: { code: 'unavailable' as const, message: (error as Error).message } }
    }
  }, [store, toasts])

  const value = useMemo(() => ({ store, route, go: setRoute, run, host, isRemote: store.transport.kind === 'remote' }), [store, route, run, host])
  return <ToastContext.Provider value={toasts}><AppContext.Provider value={value}>{children}</AppContext.Provider></ToastContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp outside AppProvider')
  return value
}

/** A slice of the engine state; the component re-renders only when the slice changes. */
export function useAppState<T>(selector: (state: AppState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useEngine(useApp().store, selector, isEqual)
}

export function useToasts(): Toast[] {
  const store = useContext(ToastContext)!
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
