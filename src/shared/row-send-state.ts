import type { MessagePosition } from './model'
import { positionMilliseconds } from './model'
import { readCovers, type ReadCursor } from './read-receipts'

// B291 (contracts/B291-chat-list-send-state.md; tdesktop Dialogs::Ui::RowPainter sendStateIcon, dialogs_layout.cpp:825-862):
// one place on a chat's row, just left of its date, says where this account's newest message there stands — a draft
// first (it stands in for the line), then one on its way, one that did not go, then the row's newest message when it is
// this account's: read by the other side (the Morse circled check, as in the bubble) or sent (a check). A line the
// server wrote before it kept its sender, a channel post's mirror, someone else's message or a secret chat show nothing.
export type RowSendState = 'none' | 'sending' | 'failed' | 'read' | 'sent'
export interface RowSendFacts {
  secret: boolean
  draft: boolean
  sending?: boolean
  failed?: boolean
  topFromMe?: boolean
  top: MessagePosition | null
  topMessageId?: string
  outboxRead: ReadCursor | null
}
export function rowSendState(row: RowSendFacts): RowSendState {
  if (row.secret || row.draft) return 'none'
  if (row.sending) return 'sending'
  if (row.failed) return 'failed'
  if (!row.topFromMe || !row.top) return 'none'
  // The row's message by its own id (lastMessageId), as the bubble's is: the read position names the message read.
  return readCovers(row.outboxRead, { at: positionMilliseconds(row.top), id: row.topMessageId ?? '' }) ? 'read' : 'sent'
}
