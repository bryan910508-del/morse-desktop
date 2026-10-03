import type { FirestoreDocument } from '../network/firestore-values'
import type { WatchResumeToken } from '../network/firestore-rpc'

// B87 (Telegram Data::Session keeps each History once it is closed — data_session.cpp:1681-1687 findOrCreate — and
// HistoryWidget::showHistory draws it at once when it isReadyFor, history_widget.cpp:3090): the latest messages of a
// chat that was open, with the resume token of their last snapshot, so opening it again shows them straight away and
// the listen asks only for what changed since. Never on disk; an account switch, the lock, a sign-out or the chat
// leaving the list forgets them.
// B103 (user rule «텔레그램 구조», review 10-04): Telegram keeps every History the session opened, so every chat opened in
// this session is kept now, not the last 8. Only the data stays — a closed chat's listen is ended as before (hundreds
// of listens are not left open); opening it again draws what was kept and listens again from its resume token.
// A bound stays against a session that opens very many chats: a kept chat is its last page (at most 81 messages,
// firestore-values.ts pageSize), so 300 of them are in the order of tens of megabytes at most.
export interface KeptHistory {
  // The history query this snapshot answered (the chat's cutoff is part of it); another query starts afresh.
  query: string
  documents: FirestoreDocument[]
  token: WatchResumeToken
}
export const keptHistoryLimit = 300

export class KeptHistories {
  private readonly entries = new Map<string, KeptHistory>()
  constructor(private readonly limit = keptHistoryLimit) {}
  get size(): number { return this.entries.size }
  keep(chatId: string, history: KeptHistory): void {
    this.entries.delete(chatId)
    this.entries.set(chatId, history)
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
  }
  // Handed to the history that opens: it is that history's own from then on.
  take(chatId: string, query: string): KeptHistory | null {
    const history = this.entries.get(chatId)
    this.entries.delete(chatId)
    return history && history.query === query ? history : null
  }
  // Chats this account no longer has.
  prune(has: (chatId: string) => boolean): void { for (const chatId of [...this.entries.keys()]) if (!has(chatId)) this.entries.delete(chatId) }
  clear(): void { this.entries.clear() }
}
