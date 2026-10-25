import type { Fetcher } from '../../../packages/engine/src/update/updater.js'

/** Every redirect stays on HTTPS. Manifest bytes and header waits are bounded. */
export const secureUpdateFetch: Fetcher = async (url, options) => {
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (!url.startsWith('https://')) throw new Error('Updates and redirects require HTTPS.')
    const controller = new AbortController()
    const abort = () => controller.abort()
    options?.signal?.addEventListener('abort', abort, { once: true })
    if (options?.signal?.aborted) controller.abort()
    const timer = setTimeout(abort, 30_000)
    let response: Response
    try { response = await fetch(url, { redirect: 'manual', signal: controller.signal }) }
    finally { clearTimeout(timer) }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      options?.signal?.removeEventListener('abort', abort)
      await response.body?.cancel()
      url = new URL(response.headers.get('location') ?? '', url).href
      continue
    }
    return { ok: response.ok, status: response.status, body: response.body, json: async () => {
      if (!response.body) throw new Error('Empty update description.')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          const item = await withDeadline(reader.read(), 30_000, 'The update description stalled.')
          if (item.done) break
          length += item.value.byteLength
          if (length > 1_000_000) throw new Error('The update description is too large.')
          chunks.push(item.value)
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
      } finally { options?.signal?.removeEventListener('abort', abort); void reader.cancel().catch(() => {}) }
    } }
  }
  throw new Error('Too many update redirects.')
}


function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms) })]).finally(() => { if (timer) clearTimeout(timer) })
}
