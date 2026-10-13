import { EventEmitter } from 'events'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { createTaskAdapters } from './providerAdapters'
import { emptySemanticResult } from './semanticResults'
import type { HeadlessOrchestrator } from '../headless/HeadlessOrchestrator'

describe('provider execution gates', () => {
  it('never spawns after cancellation during asynchronous model discovery', async () => {
    const headless = Object.assign(new EventEmitter(), { start: vi.fn(), cancel: vi.fn() })
    let resolve!: (value: any[]) => void
    const catalog = { list: vi.fn(() => new Promise<any[]>(done => { resolve = done })) }
    const adapter = createTaskAdapters(headless as unknown as HeadlessOrchestrator, undefined, catalog).find(v => v.id === 'codex')!
    const controller = new AbortController()
    const execution = adapter.execute({ root: process.cwd(), prompt: 'Do work', role: 'implementation', mode: 'developer', signal: controller.signal, onLog: vi.fn(), onRun: vi.fn() })
    controller.abort(); resolve([])
    await expect(execution).rejects.toThrow('canceled during model discovery')
    expect(headless.start).not.toHaveBeenCalled()
  })
  it('uses a configured model and restricted Claude file permissions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hydra-adapter-test-'))
    try {
      const result = emptySemanticResult(); result.terminal = true; result.text = 'done'
      const headless = Object.assign(new EventEmitter(), { start: vi.fn(() => ({id:'run',status:'completed',result})), cancel: vi.fn() })
      const adapter = createTaskAdapters(headless as unknown as HeadlessOrchestrator, () => 'configured-model', { list: async () => [{id:'catalog-model',label:'Catalog',isDefault:true}] }).find(v => v.id === 'claude')!
      await adapter.execute({ root, prompt: 'Edit file', role: 'implementation', mode: 'developer', signal: new AbortController().signal, onLog: vi.fn(), onRun: vi.fn() })
      expect(headless.start).toHaveBeenCalledWith(expect.objectContaining({model:'configured-model',accessMode:'project-write'}))
      expect(headless.listenerCount('terminal')).toBe(0)
    } finally { if (!root.startsWith(join(tmpdir(), 'hydra-adapter-test-'))) throw new Error('Invalid cleanup'); rmSync(root,{recursive:true,force:true}) }
  })
})
