import { comparePosition, positionMilliseconds, type MessagePosition } from '../../shared/model'
import { childId, documents, stringField, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'

// F-RT-004: a chat's notification from the server's state, beside the socket's newMessage hint. tdesktop announces a new
// message whichever way it came — live, or in the difference fetched after a gap (History::newItemAdded →
// notifications().schedule, history/history.cpp:1681-1706; Updates::feedDifference → processMessages(…, Unread),
// api/api_updates.cpp:612-621). The desktop's own getDifference is its watches listening again (auth/controller.ts), so
// a chat whose last message moved forward in the list — a message the server made (scheduled, «when online»), one that
// came while the socket was away, one that came while the computer slept — hands that message to the account's
// notifications, which judge it as they judge a hint (notifications.ts judge) and show a message once
// (notification-claim). The socket's hint for the same message is the same key.
//
// One message a chat: the newest. A chat's notification shows its newest message and replaces the one before
// (notifications.ts remove 'replaced'), so a run of messages that came together shows as the last of them, which is what
// tdesktop's queue ends on for that chat (System::showNext, window/notifications_manager.cpp:795-).
export interface ChatTop { chatId: string; top: MessagePosition | null; messageId: string | null; fromMe: boolean }

// The list's chats as tops: not a secret chat (its messages are not read here, notifications.ts judge), and not a
// channel's post copied into its discussion chat, which ChannelPostNotices announces as the channel's.
export function chatTopsOf(rows: Iterable<FirestoreDocument>, index: Map<string, ReadDialog>): ChatTop[] {
  const tops: ChatTop[] = []
  for (const doc of rows) {
    let chatId: string
    try { chatId = childId(doc.name, `${documents}/chats`) } catch { continue }
    const dialog = index.get(chatId)
    if (!dialog || dialog.summary.kind === 'secret' || stringField(doc.fields, 'lastSenderType', 32) === 'channel_post') continue
    tops.push({ chatId, top: dialog.summary.top, messageId: dialog.summary.topMessageId ?? null, fromMe: dialog.summary.topFromMe === true })
  }
  return tops
}

// The chats whose last message has just moved forward. The first look only remembers where every chat stands (an account
// opening does not announce its history again, as Data::Session does not on connect); a chat seen for the first time
// afterwards counts when its last message came after that first look — a new chat someone started meanwhile.
export function advancedTops(known: Map<string, MessagePosition | null>, since: number, tops: ChatTop[]): ChatTop[] {
  const moved: ChatTop[] = []
  for (const item of tops) {
    const had = known.has(item.chatId), before = known.get(item.chatId) ?? null
    known.set(item.chatId, item.top)
    if (!item.top || !item.messageId) continue
    if (had ? !before || comparePosition(item.top, before) > 0 : positionMilliseconds(item.top) > since) moved.push(item)
  }
  const present = new Set(tops.map(item => item.chatId))
  for (const chatId of [...known.keys()]) if (!present.has(chatId)) known.delete(chatId)
  return moved
}

export class ChatTopNotices {
  private readonly known = new Map<string, MessagePosition | null>()
  private since: number | null = null
  constructor(private readonly hint: (item: ChatTop) => void, private readonly now: () => number = Date.now) {}

  observe(tops: ChatTop[]): void {
    if (this.since === null) {
      this.since = this.now()
      for (const item of tops) this.known.set(item.chatId, item.top)
      return
    }
    for (const item of advancedTops(this.known, this.since, tops)) this.hint(item)
  }
}
