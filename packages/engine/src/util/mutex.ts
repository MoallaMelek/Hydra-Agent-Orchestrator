/**
 * Runs async work one at a time per key; different keys run in parallel. Keys are
 * paths, compared case-insensitively on Windows.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>()
  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const normalized = process.platform === 'win32' ? key.toLowerCase() : key
    const previous = this.tails.get(normalized) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.then(() => current)
    this.tails.set(normalized, tail)
    await previous
    try { return await fn() } finally {
      release()
      if (this.tails.get(normalized) === tail) this.tails.delete(normalized)
    }
  }
}
