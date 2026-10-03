import type { FirestoreDocument } from '../network/firestore-values'
import type { WatchResumeToken } from '../network/firestore-rpc'

// B87 (Telegram Data::Session keeps each History once it is closed — data_session.cpp:1681-1687 findOrCreate — and
// HistoryWidget::showHistory draws it at once when it isReadyFor, history_widget.cpp:3090): the latest messages of a
// chat that was open, with the resume token of their last snapshot, so opening it again shows them straight away and
// the listen asks only for what changed since. Kept in memory for the few chats opened last, never on disk; an
// account switch, the lock, a sign-out or the chat leaving the list forgets them.
export interface KeptHistory {
  // The history query this snapshot answered (the chat's cutoff is part of it); another query starts afresh.
  query: string
  documents: FirestoreDocument[]
  token: WatchResumeToken
}
export const keptHistoryLimit = 8

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
