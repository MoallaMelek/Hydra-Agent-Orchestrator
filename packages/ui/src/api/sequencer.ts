import { DURABLE_EVENT_TYPES, type EventEnvelope } from '@hydra/protocol'

/**
 * Applies engine events exactly once and in journal order on a connection that can
 * drop. While catching up after a reconnect, live journal events are held back and
 * applied after the replay, so a newer live event never hides older missed ones.
 */
export class EventSequencer {
  /** Highest journal sequence number applied. */
  cursor = 0
  private catchingUp = false
  private held: EventEnvelope[] = []

  constructor(private readonly apply: (envelope: EventEnvelope) => void) {}

  /** A live event from the connection. */
  receive(envelope: EventEnvelope): void {
    if (this.catchingUp && DURABLE_EVENT_TYPES.has(envelope.event.type)) { this.held.push(envelope); return }
    this.applyOnce(envelope)
  }

  beginCatchUp(): void {
    this.catchingUp = true
    this.held = []
  }

  /** A page of replayed journal events, oldest first. */
  replay(events: readonly EventEnvelope[], lastSeqExamined: number): void {
    for (const envelope of events) this.applyOnce(envelope)
    this.cursor = Math.max(this.cursor, lastSeqExamined)
  }

  /** Ends the catch-up: applies held live events in order, skipping any the replay already covered. */
  endCatchUp(): void {
    this.catchingUp = false
    const held = this.held.sort((a, b) => a.seq - b.seq)
    this.held = []
    for (const envelope of held) this.applyOnce(envelope)
  }

  private applyOnce(envelope: EventEnvelope): void {
    if (DURABLE_EVENT_TYPES.has(envelope.event.type)) {
      if (envelope.seq <= this.cursor) return
      this.cursor = envelope.seq
    }
    this.apply(envelope)
  }
}
