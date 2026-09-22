import { boolField, expiry, stringField, type FirestoreDocument } from '../network/firestore-values'

// Data::Session::checkTTLs(): the moment a message's time passes it leaves the history, and in Telegram it is gone
// for everybody, because the server itself removed it. Morse's server only stamps the moment (deleteAt) and leaves
// the removal to whichever client has the room open — ChatRoomView.purgeAutoDeletedMessagesIfNeeded does exactly
// that on iOS — so an open room here removes what has expired, for both sides, at its moment.
//
// Only a message the server itself stamped is ever removed: one written before the policy was set carries no stamp
// and stays, as it does in Telegram, where the timer applies to what is sent after it. A system line is left alone
// (the auto-delete notice explains the policy), and a group removes only this account's own messages, which is what
// iOS does and all the rules would allow anyway.
const maxPerSweep = 25

export interface ExpiredCandidate { id: string; doc: FirestoreDocument; senderId: string; at: number }

export function expiredCandidates(docs: Iterable<FirestoreDocument>, now: number): ExpiredCandidate[] {
  const expired: ExpiredCandidate[] = []
  for (const doc of docs) {
    try {
      const at = expiry(doc)
      if (at === null || at > now) continue
      const f = doc.fields, senderId = stringField(f, 'senderId', 160)
      if (!senderId || boolField(f, 'isSystem')) continue
      const id = doc.name.slice(doc.name.lastIndexOf('/') + 1)
      if (id && !id.includes('/')) expired.push({ id, doc, senderId, at })
    } catch { /* A row that cannot be read is not removed. */ }
  }
  return expired.sort((a, b) => a.at - b.at).slice(0, maxPerSweep)
}
// scheduleNextTTLs(): when the room should look again, or null while nothing is waiting.
export function nextExpiry(docs: Iterable<FirestoreDocument>, now: number): number | null {
  let nearest: number | null = null
  for (const doc of docs) {
    try {
      const at = expiry(doc)
      if (at === null || at <= now) continue
      if (nearest === null || at < nearest) nearest = at
    } catch { /* A row that cannot be read waits for nothing. */ }
  }
  return nearest
}

export class ExpiredMessages {
  private readonly removed = new Set<string>()
  private running = false
  private closed = false
  constructor(private readonly remove: (entry: ExpiredCandidate) => Promise<void>,
    private readonly allowed: (entry: ExpiredCandidate) => boolean,
    private readonly now: () => number = Date.now) {}

  // Called whenever the open room's rows change and again at the moment the next one expires.
  sweep(docs: Iterable<FirestoreDocument>): void {
    if (this.closed || this.running) return
    const entries = expiredCandidates(docs, this.now()).filter(entry => !this.removed.has(entry.id) && this.allowed(entry))
    if (!entries.length) return
    this.running = true
    void (async () => {
      for (const entry of entries) {
        if (this.closed) break
        // Removed once per run: a failure leaves it to the next pass or to the other side, never to a loop.
        this.removed.add(entry.id)
        try { await this.remove(entry) } catch { /* The other side removes it too; nothing is retried here. */ }
      }
      this.running = false
    })()
  }
  clear(): void { this.removed.clear() }
  close(): void { this.closed = true; this.removed.clear() }
}
