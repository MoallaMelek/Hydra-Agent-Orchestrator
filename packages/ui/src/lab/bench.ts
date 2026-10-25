import type { FixtureWorld } from './world'

/**
 * Measures how the interface copes with a burst of engine events (the "flood" fixture).
 * Same harness for the old and the new interface, so the numbers compare like for like.
 * Results land on window.__bench.
 */
export interface BenchResult {
  events: number
  wallMs: number
  frames: number
  avgFrameMs: number
  maxFrameMs: number
  framesOver50ms: number
  longTasks: number
  longTaskMs: number
  heapDeltaMb: number | null
  domNodes: number
}

declare global {
  interface Window { __bench?: BenchResult | { error: string }; __floodDone?: Promise<void> }
}

export async function runBench(world: FixtureWorld, ready: Promise<string>): Promise<void> {
  try {
    await ready
    await new Promise((r) => setTimeout(r, 400))
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const heap0 = memory?.usedJSHeapSize ?? null
    let events = 0
    const off = world.on(() => { events++ })
    const long: number[] = []
    const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) long.push(entry.duration) })
    try { observer.observe({ type: 'longtask', buffered: false }) } catch { /* not supported */ }
    const frames: number[] = []
    let last = performance.now()
    let running = true
    const tick = (now: number) => { frames.push(now - last); last = now; if (running) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    const start = performance.now()
    await window.__floodDone
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const wallMs = performance.now() - start
    running = false
    observer.disconnect()
    off()
    const heap1 = memory?.usedJSHeapSize ?? null
    window.__bench = {
      events, wallMs: Math.round(wallMs), frames: frames.length,
      avgFrameMs: +(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length)).toFixed(1),
      maxFrameMs: Math.round(Math.max(0, ...frames)), framesOver50ms: frames.filter((f) => f > 50).length,
      longTasks: long.length, longTaskMs: Math.round(long.reduce((a, b) => a + b, 0)),
      heapDeltaMb: heap0 !== null && heap1 !== null ? +((heap1 - heap0) / 1048576).toFixed(1) : null,
      domNodes: document.getElementsByTagName('*').length
    }
  } catch (error) {
    window.__bench = { error: (error as Error).message }
  }
}
