/**
 * Progress of a position tween, eased and clamped to [0, 1].
 * Frame timestamps from requestAnimationFrame can be earlier than a start time taken with
 * performance.now() later in the same frame; unclamped, the easing then goes negative and a
 * scene retargeted every frame (replay) pushes marks away from their places instead of towards them.
 */
export function tweenProgress(now: number, start: number, duration: number): number {
  if (!(duration > 0)) return 1
  const t = Math.min(1, Math.max(0, (now - start) / duration))
  return 1 - Math.pow(1 - t, 3)
}
