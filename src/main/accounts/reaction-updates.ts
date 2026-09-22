import type { ChatMessage } from '../../shared/model'
import { reactionsFromMap, reactionVersion, type FirestoreDocument } from '../network/firestore-values'

// reactionUpdated (docs/reaction-socket-contract-2026-09-22.md §3) carries a message's whole reaction state, as
// Telegram's updateMessageReactions replaces a message's ReactionsMessageAttribute. It arrives before the message
// document does; until the document has caught up with that reactionVersion, the event's state is the one shown,
// and after that the document is authoritative again (the Firestore path stays, and agrees).
export class ReactionUpdates {
  private readonly updates = new Map<string, { map: Record<string, unknown>; version: number }>()

  // False when the event is no newer than what is known already.
  remember(messageId: string, map: Record<string, unknown>, version: number, doc: FirestoreDocument | undefined): boolean {
    if (!Number.isSafeInteger(version) || version < 0) return false
    if (doc && reactionVersion(doc) >= version) return false
    const known = this.updates.get(messageId)
    if (known && known.version >= version) return false
    this.updates.set(messageId, { map, version })
    if (this.updates.size > 500) this.updates.delete(this.updates.keys().next().value!)
    return true
  }
  // The reactions to show for this document: the event's while it is ahead of the document, otherwise none.
  reactions(messageId: string, doc: FirestoreDocument | undefined, uid: string, names?: Record<string, string>): ChatMessage['reactions'] | null {
    const update = this.updates.get(messageId)
    if (!update) return null
    if (doc && reactionVersion(doc) >= update.version) { this.updates.delete(messageId); return null }
    return reactionsFromMap(update.map, uid, names)
  }
  clear(): void { this.updates.clear() }
}
