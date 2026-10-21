

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { downloadUpdate, type Fetcher } from './updater.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>()
  return { ...real, open: async (...args: Parameters<typeof real.open>) => {
    const handle = await real.open(...args)
    return {
      write: (value: Uint8Array) => handle.write(value.subarray(0, 3)),
      writeFile: (value: Uint8Array) => handle.writeFile(value),
      close: () => handle.close()
    }
  } }
})

it('writes every byte even when a single write would be partial', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hydra-partial-'))
  const bytes = Buffer.from('installer chunk longer than one partial write')
  const fetcher: Fetcher = async () => ({
    ok: true, status: 200, json: async () => ({}),
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
  })
  try {
    const path = await downloadUpdate({ platform: 'win32-x64', name: 'installer.exe',
      url: 'https://releases.example.com/installer.exe', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }, dir, fetcher)
    expect(await readFile(path)).toEqual(bytes)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
