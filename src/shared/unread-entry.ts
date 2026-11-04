import type { ChatMessage } from './model'
import { readCovers, readCursor, type ReadCursor } from './read-receipts'

// F-MB-003: where a room with unread messages opens — tdesktop's ShowAtUnreadMsgId. The first unread message goes to the
// top under «읽지 않은 메시지» only when the read boundary is in the loaded page; otherwise tdesktop reads the page around
// it (HistoryWidget::firstLoadMessages, loadAroundId, history_widget.cpp:4998-5009), which here is 'around'. A page with
// no read position and fewer rows than the count cannot say where the unread start, so it opens at the bottom with no
// divider, as iOS MorseChatEntryUnreadAnchor never puts it over an arbitrary message.
export type UnreadEntry = { kind: 'message'; id: string } | { kind: 'bottom' } | { kind: 'around' }

export function unreadCandidate(message: ChatMessage, cursor: ReadCursor | null | undefined, self: string): boolean {
  return message.senderId !== self && message.readEligible && !message.system && !readCovers(cursor, readCursor(message.position))
}

export function unreadEntry(page: { messages: ChatMessage[]; hasMore: boolean }, unreadCount: number, cursor: ReadCursor | null | undefined, self: string): UnreadEntry {
  if (!(unreadCount > 0) || !page.messages.length) return { kind: 'bottom' }
  if (cursor) {
    // The boundary is loaded when a loaded message is covered by the read position, or the page is the whole history.
    const reaches = !page.hasMore || page.messages.some(message => readCovers(cursor, readCursor(message.position)))
    if (!reaches) return { kind: 'around' }
    const first = page.messages.find(message => unreadCandidate(message, cursor, self))
    return first ? { kind: 'message', id: first.id } : { kind: 'bottom' }
  }
  if (unreadCount > page.messages.length && page.hasMore) return { kind: 'bottom' }
  return { kind: 'message', id: page.messages[Math.max(0, page.messages.length - unreadCount)]!.id }
}
