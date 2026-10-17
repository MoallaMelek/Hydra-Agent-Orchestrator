import { expect, it } from 'vitest'
import { checkForUpdate, type Fetcher } from './updater.js'

const config = { manifestUrl: 'https://example.com/manifest.json', publicKeyHex: 'ab'.repeat(32), currentVersion: '2.0.0', platform: 'win32-x64' }

it('bounds an update server that never answers', async () => {
  const stalled: Fetcher = () => new Promise(() => {})
  await expect(checkForUpdate(config, stalled, 10)).rejects.toThrow('did not answer')
})

it('bounds a manifest body that never finishes', async () => {
  const stalled: Fetcher = async () => ({ ok: true, status: 200, body: null, json: () => new Promise(() => {}) })
  await expect(checkForUpdate(config, stalled, 10)).rejects.toThrow('description stalled')
})
