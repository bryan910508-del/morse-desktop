import type { PeerPresence } from '../../shared/presence'

// presenceRedacted/{viewer}/{target} is a copy the server wrote for this viewer, and a copy that says «online» carries
// no time of its own, so a person subscribed to a moment ago could read as online long after they left. Such a copy is
// held until resolvePeerPresences has answered for that person (iOS MorsePeerPresenceStore); every other copy carries
// its own last seen and is shown at once. An answer that never arrives releases the copy, so a call that failed can
// never hide somebody for good.
export class PresenceHold {
  private waiting = new Map<string, PeerPresence | null>()

  start(id: string): void { if (!this.waiting.has(id)) this.waiting.set(id, null) }
  // What to show now, or null while this person's copy is held back.
  receive(id: string, value: PeerPresence): PeerPresence | null {
    if (value.s === 'online' && this.waiting.has(id)) { this.waiting.set(id, value); return null }
    this.waiting.delete(id)
    return value
  }
  // The server answered for this person: its value is the one to show.
  answered(id: string, value: PeerPresence): PeerPresence { this.waiting.delete(id); return value }
  // The call settled, whatever it said: what was held back is shown.
  settled(id: string): PeerPresence | null {
    const held = this.waiting.get(id) ?? null
    this.waiting.delete(id)
    return held && held.s !== 'none' ? held : null
  }
  forget(id: string): void { this.waiting.delete(id) }
  clear(): void { this.waiting.clear() }
}
