import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { composeRequest, draftCount, getPreferences, initializePreferences, putDraft, setTheme, setQuality, flushPreferences, validPreferences } from './preferences'

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
})
afterEach(() => vi.unstubAllGlobals())
describe('user drafts and preferences', () => {
  it('keeps independent project, conversation and attachment drafts across initialization and persists themes before paint', async () => {
    let saved: unknown = { theme: 'terracotta', drafts: {} }
    const host = { readPreferences: async () => saved as ReturnType<typeof getPreferences>, writePreferences: async (value: unknown) => { saved = structuredClone(value) } }
    await initializePreferences(host)
    expect(document.documentElement.dataset.theme).toBe('terracotta')
    putDraft('project:a', { text: 'A unsent', attachments: [{ name: 'notes.md', content: 'keep me' }] })
    putDraft('project:b', { text: 'B unsent', attachments: [] })
    putDraft('follow:task-a', { text: 'follow-up', attachments: [] })
    setTheme('light'); setQuality('minimal'); await flushPreferences(); await initializePreferences(host)
    expect(getPreferences().quality).toBe('minimal')
    expect(getPreferences().drafts['project:a']?.attachments[0]?.content).toBe('keep me')
    expect(getPreferences().drafts['project:b']?.text).toBe('B unsent')
    expect(draftCount()).toBe(3); expect(document.documentElement.dataset.theme).toBe('light')
    putDraft('project:a', { text: '', attachments: [] }); await flushPreferences()
    expect(draftCount()).toBe(2)
  })
  it('rejects malformed stored drafts and bounds the actual request including attachments', () => {
    expect(validPreferences({ theme: 'fake', drafts: {} })).toBe(false)
    expect(validPreferences({ theme: 'dark', drafts: { a: { text: 'x', attachments: [{ name: 'x' }] } } })).toBe(false)
    expect(composeRequest('Inspect', [{ name: 'readme.md', content: 'example' }])).toContain('Attached text file: readme.md')
    expect(() => composeRequest('x'.repeat(49000), [{ name: 'large.md', content: 'y'.repeat(2000) }])).toThrow('50,000')
  })
  it('coalesces slow disk writes and flushes the final draft before close', async () => {
    let release: (() => void) | null = null
    const saved: string[] = []
    const host = {
      readPreferences: async () => ({ theme: 'dark' as const, drafts: {} }),
      writePreferences: async (value: ReturnType<typeof getPreferences>) => { if (!saved.length) await new Promise<void>(resolve => { release = resolve }); saved.push(value.drafts['project:slow']?.text ?? '') }
    }
    await initializePreferences(host)
    putDraft('project:slow', { text: 'first', attachments: [] })
    for (let index = 0; index < 100; index++) putDraft('project:slow', { text: `edit ${index}`, attachments: [] })
    const flush = flushPreferences()
    ;(release as (() => void) | null)?.()
    await flush
    expect(saved.at(-1)).toBe('edit 99')
    expect(saved.length).toBeLessThanOrEqual(2)
  })
})
