import type { ChatMessage } from '../../shared/model'

// Which options this account chose in a poll. The tally lives on the message, but a person's own answer
// does not: the server keeps it at messages/{id}/pollVotes/{uid} (morse-release-authority.js), and
// firestore.rules lets the voter `get` their own — even in an anonymous poll — while refusing `list`.
// So it is read one document at a time, for the polls on screen, and again whenever the message moves
// (anyone voting changes it, and this account may have voted from another device).
//
// Without this the card had nothing but the optimistic overlay to show: a vote appeared, and then
// vanished the moment somebody else answered and the overlay gave way to the server's copy. A poll that
// forbids changing a vote also looked open again, and the server refused the second try.
export class PollVotes {
  private readonly votes = new Map<string, { options: number[]; at: string }>()
  private readonly reading = new Set<string>()
  private closed = false
  constructor(private readonly read: (messageId: string) => Promise<number[] | null>, private readonly changed: () => void) {}

  // Null until this account's answer for that poll is known: «not voted» and «not read yet» are both
  // drawn as no answer, and the card simply gains the marks when the read lands.
  mine(messageId: string): number[] | null { return this.votes.get(messageId)?.options ?? null }

  // The polls on screen. A read starts for one whose answer is unknown, or was read before the message
  // moved on; nothing is read twice at once.
  follow(messages: readonly ChatMessage[]): void {
    if (this.closed) return
    const wanted = new Set<string>()
    for (const message of messages) {
      if (message.kind !== 'poll' || !message.poll || message.encrypted) continue
      wanted.add(message.id)
      const known = this.votes.get(message.id)
      if (known?.at === message.version || this.reading.has(message.id)) continue
      this.reading.add(message.id)
      const at = message.version
      void this.read(message.id).then(options => {
        this.reading.delete(message.id)
        if (this.closed) return
        const before = this.votes.get(message.id)
        this.votes.set(message.id, { options: options ?? [], at })
        if (this.votes.size > 200) this.votes.delete(this.votes.keys().next().value!)
        if (!before || before.at !== at || String(before.options) !== String(options ?? [])) this.changed()
      }, () => { this.reading.delete(message.id) })
    }
    // A poll that scrolled out of the window keeps its answer only while the window holds it.
    for (const id of [...this.votes.keys()]) if (!wanted.has(id)) this.votes.delete(id)
  }
  close(): void { this.closed = true; this.votes.clear(); this.reading.clear() }
}
