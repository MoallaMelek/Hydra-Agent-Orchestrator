import { describe, expect, it } from 'vitest'
import { tweenProgress } from './tween'

describe('tweenProgress', () => {
  it('stays within 0..1 even when the frame timestamp precedes the start', () => {
    expect(tweenProgress(100, 105, 260)).toBe(0)
    expect(tweenProgress(500, 100, 260)).toBe(1)
    expect(tweenProgress(230, 100, 260)).toBeGreaterThan(0.5)
    expect(tweenProgress(0, 0, 0)).toBe(1)
  })

  it('moves a mark only towards its place, frame after frame, even with early frame timestamps', () => {
    // A tween started mid-frame is sampled at frame timestamps, the first of which can precede it.
    const start = 1004, from = 10, to = 0
    let last = from
    for (let frame = 1000; frame < 1400; frame += 16.7) {
      const x = from + (to - from) * tweenProgress(frame, start, 260)
      expect(Math.abs(x - to)).toBeLessThanOrEqual(Math.abs(last - to))
      last = x
    }
    expect(last).toBe(to)
  })
})
