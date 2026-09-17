import type { FirestoreReader } from '../network/firestore-rpc'
import { childId, documents, positionValue, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { comparePosition, type MessagePosition } from '../../shared/model'

// Channel post notifications (Telegram's «Channels», iOS 설정 → 알림 → 채널). The server copies a new post into the
// channel's discussion chat as a «channelPost» card, moves the chat's last message to it with
// lastSenderType «channel_post», and pushes it to iOS (functions onChannelPostCreated). The desktop watches its
// discussion chats for that move and hands the card to the account's notifications.
export interface DiscussionTop { chatId: string; top: MessagePosition | null; channelPost: boolean }

// The discussion chats whose last message has just moved forward to a channel post. The first look only remembers
// where every chat stands, and a chat seen for the first time is remembered without a notice.
export function advancedChannelPosts(known: Map<string, MessagePosition | null>, primed: boolean, tops: DiscussionTop[]): DiscussionTop[] {
  const moved: DiscussionTop[] = []
  for (const item of tops) {
    const had = known.has(item.chatId), before = known.get(item.chatId) ?? null
    known.set(item.chatId, item.top)
    if (!primed || !had || !item.top || !item.channelPost) continue
    if (!before || comparePosition(item.top, before) > 0) moved.push(item)
  }
  const present = new Set(tops.map(item => item.chatId))
  for (const chatId of [...known.keys()]) if (!present.has(chatId)) known.delete(chatId)
  return moved
}

export class ChannelPostNotices {
  private readonly known = new Map<string, MessagePosition | null>()
  private primed = false
  constructor(private readonly hint: (chatId: string, messageId: string) => void) {}

  observe(rows: Iterable<FirestoreDocument>, index: Map<string, ReadDialog>, reader: FirestoreReader | null, signal: AbortSignal): void {
    const tops: DiscussionTop[] = []
    for (const doc of rows) {
      let chatId: string
      try { chatId = childId(doc.name, `${documents}/chats`) } catch { continue }
      const dialog = index.get(chatId)
      if (!dialog?.summary.discussion) continue
      tops.push({ chatId, top: dialog.summary.top, channelPost: stringField(doc.fields, 'lastSenderType', 32) === 'channel_post' })
    }
    const moved = advancedChannelPosts(this.known, this.primed, tops)
    this.primed = true
    if (!reader) return
    for (const item of moved) void this.find(item, reader, signal)
  }
  reset(): void { this.known.clear(); this.primed = false }

  // The card is the channelPost message written at the chat's new last-message time.
  private async find(item: DiscussionTop, reader: FirestoreReader, signal: AbortSignal): Promise<void> {
    try {
      const rows = await reader.query(`${documents}/chats/${item.chatId}`, { from: [{ collectionId: 'messages' }],
        where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: positionValue(item.top!) } },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 5 } }, signal)
      for (const doc of rows) {
        if (stringField(doc.fields, 'type', 64) !== 'channelPost') continue
        this.hint(item.chatId, childId(doc.name, `${documents}/chats/${item.chatId}/messages`))
      }
    } catch { /* A card that cannot be read now is not announced later. */ }
  }
}
