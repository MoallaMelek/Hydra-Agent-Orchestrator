import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light' | 'terracotta'
export interface Attachment { name: string; content: string }
export interface Draft { text: string; attachments: Attachment[]; routing?: 'auto' | 'fast' | 'standard' | 'deep'; mode?: 'safe' | 'developer' | 'autonomous' }
export interface Preferences { theme: Theme; quality?: 'auto' | 'full' | 'reduced' | 'minimal'; drafts: Record<string, Draft> }
export interface PreferenceHost {
  readPreferences?: () => Promise<Preferences>
  writePreferences?: (value: Preferences) => Promise<void>
}
const EMPTY: Draft = { text: '', attachments: [] }
const KEY = 'hydra.preferences.v1'
const listeners = new Set<() => void>()
let current: Preferences = { theme: 'dark', drafts: {} }
let host: PreferenceHost = {}
let persistenceError = ''
let pending: Promise<void> | null = null
let latestWrite: Preferences | null = null

export function validPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== 'object') return false
  const data = value as Preferences
  return ['dark', 'light', 'terracotta'].includes(data.theme) && (!data.quality || ['auto', 'full', 'reduced', 'minimal'].includes(data.quality)) && !!data.drafts && typeof data.drafts === 'object' &&
    Object.keys(data.drafts).length <= 100 && Object.values(data.drafts).every(draft =>
      typeof draft.text === 'string' && draft.text.length <= 50000 && Array.isArray(draft.attachments) && draft.attachments.length <= 8 &&
      (!draft.routing || ['auto', 'fast', 'standard', 'deep'].includes(draft.routing)) && (!draft.mode || ['safe', 'developer', 'autonomous'].includes(draft.mode)) &&
      draft.attachments.every(file => typeof file.name === 'string' && file.name.length <= 200 && typeof file.content === 'string' && file.content.length <= 16000))
}

/** Called before React mounts. Desktop storage has a stable path despite hydrad's random port. */
export async function initializePreferences(bridge: PreferenceHost): Promise<void> {
  host = bridge
  current = { theme: 'dark', drafts: {} }
  try {
    const value: unknown = host.readPreferences ? await host.readPreferences() : JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (validPreferences(value)) current = value
    else {
      const previous = localStorage.getItem('hydra.theme')
      if (previous === 'light' || previous === 'dark') current.theme = previous
    }
  } catch { persistenceError = 'Could not restore saved interface preferences.' }
  document.documentElement.dataset.theme = current.theme
}

function publish(next: Preferences): void {
  current = next
  document.documentElement.dataset.theme = next.theme
  try { localStorage.setItem(KEY, JSON.stringify(next)); persistenceError = '' } catch { persistenceError = 'Drafts are kept in memory; local storage is unavailable.' }
  if (host.writePreferences) { latestWrite = next; void drain() }
  emit()
}
function drain(): Promise<void> {
  if (pending) return pending
  pending = (async () => {
    // At most one in-flight snapshot and one latest snapshot, even on a slow disk.
    while (latestWrite && host.writePreferences) {
      const value = latestWrite; latestWrite = null
      try {
        if (JSON.stringify(value).length > 2_000_000) throw new Error('Draft storage limit reached')
        await host.writePreferences(value)
        persistenceError = ''
      } catch { persistenceError = 'Draft could not be saved to disk. Send, copy or shorten unsent work before closing.'; emit(); break }
    }
  })().finally(() => { pending = null })
  return pending
}
function emit() { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
export const getPreferences = () => current
export async function flushPreferences(): Promise<void> {
  if (host.writePreferences) {
    latestWrite = current
    await drain()
    if (latestWrite) await drain()
    if (persistenceError) throw new Error(persistenceError)
  } else if (persistenceError) throw new Error(persistenceError)
}
export const draftCount = () => Object.values(current.drafts).filter(value => value.text.trim() || value.attachments.length).length
export function setTheme(theme: Theme): void { publish({ ...current, theme }) }
export function setQuality(quality: NonNullable<Preferences['quality']>): void { publish({ ...current, quality }) }
export function putDraft(key: string, draft: Draft): void {
  const drafts = { ...current.drafts }
  if (!draft.text && !draft.attachments.length) delete drafts[key]
  else drafts[key] = draft
  if (Object.keys(drafts).length > 100) { persistenceError = 'Draft limit reached. Send or discard another draft first.'; emit(); return }
  publish({ ...current, drafts })
}
export function useDraft(key: string) {
  const value = useSyncExternalStore(subscribe, () => current.drafts[key] ?? EMPTY)
  const error = useSyncExternalStore(subscribe, () => persistenceError)
  return { ...value, error, set: (patch: Partial<Draft>) => putDraft(key, { ...(current.drafts[key] ?? EMPTY), ...patch }) }
}
export function useTheme(): Theme { return useSyncExternalStore(subscribe, () => current.theme) }
export function useSavedDrafts(): Preferences['drafts'] { return useSyncExternalStore(subscribe, () => current.drafts) }

export function composeRequest(text: string, attachments: Attachment[]): string {
  const result = text + attachments.map(file => `\n\nAttached text file: ${file.name}\n<attachment>\n${file.content}\n</attachment>`).join('')
  if (result.length > 50000) throw new Error('Message and attachments exceed 50,000 characters. Remove an attachment or shorten the message.')
  return result
}
