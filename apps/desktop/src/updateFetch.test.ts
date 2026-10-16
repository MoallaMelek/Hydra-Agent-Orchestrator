import { afterEach, describe, expect, it, vi } from 'vitest'
import { secureUpdateFetch } from './updateFetch.js'

afterEach(() => vi.unstubAllGlobals())
describe('desktop release transport', () => {
  it('rejects a redirect to HTTP before making an insecure request', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://insecure.invalid/update' } }))
    vi.stubGlobal('fetch', fetcher)
    await expect(secureUpdateFetch('https://github.com/releases/test')).rejects.toThrow('HTTPS')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('follows bounded HTTPS redirects and reads a small manifest', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/test' } })).mockResolvedValueOnce(new Response('{"schema":1}'))
    vi.stubGlobal('fetch', fetcher)
    const response = await secureUpdateFetch('https://github.com/releases/test')
    expect(await response.json()).toEqual({ schema: 1 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects oversized manifests and redirect loops', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(1_000_001))))
    await expect((await secureUpdateFetch('https://example.invalid/release')).json()).rejects.toThrow('too large')
    const redirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.invalid/again' } }))
    vi.stubGlobal('fetch', redirect)
    await expect(secureUpdateFetch('https://example.invalid/release')).rejects.toThrow('Too many')
    expect(redirect).toHaveBeenCalledTimes(6)
  })
})
