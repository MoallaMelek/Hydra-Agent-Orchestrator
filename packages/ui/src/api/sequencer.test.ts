import { describe, expect, it } from 'vitest'
import type { EventEnvelope } from '@hydra/protocol'
import { EventSequencer } from './sequencer'

const log = (seq: number): EventEnvelope => ({ seq, at: '2026-10-13T00:00:00.000Z', event: { type: 'task.log', taskId: 't', level: 'info', message: `m${seq}` } })
const live = (seq: number): EventEnvelope => ({ seq, at: '2026-10-13T00:00:00.000Z', event: { type: 'run.output', runId: 'r', taskId: 't', text: `o${seq}` } })

describe('event sequencing across reconnects', () => {
  it('a live event arriving during catch-up does not hide the missed ones', () => {
    const applied: number[] = []
    const s = new EventSequencer((e) => applied.push(e.seq))
    s.cursor = 100
    s.beginCatchUp()
    s.receive(log(105)) // live, overtakes the replay
    s.replay([log(101), log(102), log(103), log(104), log(105)], 105)
    s.endCatchUp()
    expect(applied).toEqual([101, 102, 103, 104, 105])
    expect(s.cursor).toBe(105)
  })

  it('applies held events newer than the replay after it, in order and once', () => {
    const applied: number[] = []
    const s = new EventSequencer((e) => applied.push(e.seq))
    s.cursor = 10
    s.beginCatchUp()
    s.receive(log(14))
    s.receive(log(13))
    s.replay([log(11), log(12)], 12)
    s.endCatchUp()
    s.receive(log(13)) // duplicate after catch-up
    expect(applied).toEqual([11, 12, 13, 14])
  })

  it('passes live-only output through at once, even during catch-up', () => {
    const applied: string[] = []
    const s = new EventSequencer((e) => applied.push(e.event.type))
    s.beginCatchUp()
    s.receive(live(0))
    expect(applied).toEqual(['run.output'])
  })
})
