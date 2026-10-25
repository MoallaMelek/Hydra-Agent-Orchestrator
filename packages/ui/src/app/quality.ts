import { useEffect, useState } from 'react'
import { getPreferences, setQuality } from './preferences'

/**
 * Visual quality, per viewer: Auto (default), Full, Reduced (no movement, short fades)
 * or Minimal (no transitions, no per-tool marks). Lower levels never hide information.
 * Auto follows the system's reduced-motion setting and steps down to Minimal for the
 * session when the page keeps missing frames (long tasks while it is visible).
 */
export type QualityChoice = 'auto' | 'full' | 'reduced' | 'minimal'
export type Quality = Exclude<QualityChoice, 'auto'>

const KEY = 'hydra.quality'
const listeners = new Set<() => void>()
let strained = false

export function readChoice(): QualityChoice {
  const saved = getPreferences().quality
  if (saved) return saved
  try { const v = localStorage.getItem(KEY); return v === 'full' || v === 'reduced' || v === 'minimal' ? v : 'auto' } catch { return 'auto' }
}

export function setChoice(choice: QualityChoice): void {
  setQuality(choice)
  try { localStorage.setItem(KEY, choice) } catch { /* private mode: this session only */ }
  for (const l of listeners) l()
}

export function effective(choice: QualityChoice): Quality {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return choice === 'minimal' ? 'minimal' : 'reduced'
  if (choice !== 'auto') return choice
  if (strained) return 'minimal'
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'
}

/** Applies the quality to the document and keeps it current. Returns [choice, effective]. */
export function useQuality(): [QualityChoice, Quality] {
  const [choice, setLocal] = useState(readChoice)
  const [, bump] = useState(0)
  useEffect(() => {
    const update = () => { setLocal(readChoice()); bump((n) => n + 1) }
    listeners.add(update)
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    media.addEventListener('change', update)
    // Watchdog: five long tasks within ten seconds, after start-up, means this machine is struggling.
    let observer: PerformanceObserver | null = null
    const recent: number[] = []
    const armed = setTimeout(() => {
      try {
        observer = new PerformanceObserver((list) => {
          if (document.visibilityState !== 'visible') return
          const now = performance.now()
          for (const entry of list.getEntries()) if (entry.duration > 80) recent.push(now)
          while (recent.length && now - recent[0]! > 10_000) recent.shift()
          if (recent.length >= 5 && !strained) { strained = true; for (const l of listeners) l() }
        })
        observer.observe({ type: 'longtask', buffered: false })
      } catch { /* not supported */ }
    }, 8000)
    return () => { listeners.delete(update); media.removeEventListener('change', update); clearTimeout(armed); observer?.disconnect() }
  }, [])
  const value = effective(choice)
  useEffect(() => { document.documentElement.dataset.quality = value }, [value])
  return [choice, value]
}
