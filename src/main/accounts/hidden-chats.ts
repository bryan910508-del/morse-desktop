import { comparePosition, positionAt, positionMilliseconds, type DialogSummary, type MessagePosition } from '../../shared/model'
import type { HiddenChatCommand } from '../storage/hidden-chat-table'
import type { ReadDialog } from '../network/firestore-values'
import { tr } from '../../shared/i18n'

// Telegram's "Delete chat" for me only, and iOS "나에게만 삭제" (MorseChatRetentionPlan: hiddenChatIds +
// clearedAt_*, the server's chats and messages untouched). The moment of deleting is kept on this
// device for good: every message at or before it stays deleted here (ChatRoomView skips createdAt <=
// clearedAt), and the room stays out of the list until a message newer than it arrives
// (ChatListLocalStateStore.reconcileHiddenChats) - that message brings the room back with only
// what came after.
//
// The moments are read from this device once per session; the list is rebuilt when they arrive, and
// since a rebuild asks for them again, only the first ask reads. A deletion or restore made while
// that read is on its way is newer than what it brings back, so it is not overwritten.
export class HiddenChats {
  private readonly at = new Map<string, number>()
  // The boundary this device cleared a room's history at ("대화 기록 삭제"); see keepsCleared.
  private readonly cleared = new Map<string, number>()
  // Rooms whose clear is on its way: the server's boundary reaches the list before the callable answers with it.
  private readonly clearing = new Set<string>()
  private readonly touched = new Set<string>()
  private state: 'unread' | 'reading' | 'read' = 'unread'
  private closed = false

  constructor(private readonly store: <T>(command: HiddenChatCommand) => Promise<T>,
    private readonly arrived: () => void, private readonly now: () => number = Date.now) {}

  load(): void {
    if (this.closed || this.state !== 'unread') return
    this.state = 'reading'
    Promise.all([this.store<{ chatId: string; hiddenAt: number }[]>({ kind: 'hidden-chats-read' }),
      this.store<{ chatId: string; cutoff: number }[]>({ kind: 'cleared-chats-read' })]).then(([rows, clearedRows]) => {
      if (this.closed) return
      if (!Array.isArray(rows) || !Array.isArray(clearedRows)) throw new Error('Unreadable hidden chats')
      for (const row of rows) if (!this.touched.has(row.chatId)) this.at.set(row.chatId, row.hiddenAt)
      for (const row of clearedRows) if (!this.cleared.has(row.chatId)) this.cleared.set(row.chatId, row.cutoff)
      this.touched.clear()
      this.state = 'read'
      if (rows.length || clearedRows.length) this.arrived()
    }).catch(() => {
      // Until a read succeeds the list shows every room; the next rebuild asks again.
      if (!this.closed && this.state === 'reading') this.state = 'unread'
    })
  }

  // The history boundary this device keeps for a room: a message before it is not shown. It sits
  // just past the moment of deleting, since a history boundary keeps what lies exactly on it.
  cutoff(chatId: string): MessagePosition | null {
    const at = this.closed ? undefined : this.at.get(chatId)
    return at === undefined ? null : positionAt(Math.floor(at) + 1, '')
  }

  // Reading only: the room is left out while its last message is one that was deleted.
  hides(summary: DialogSummary): boolean {
    const cutoff = this.cutoff(summary.id)
    return cutoff !== null && (!summary.top || comparePosition(summary.top, cutoff) < 0)
  }

  // Telegram Desktop lists a private chat while it has a last message (History::shouldBeInChatList:
  // `!lastMessageKnown() || lastMessage() != nullptr`). "Delete chat" leaves none (History::clear(DeleteChat)), and the
  // other side of a delete for everyone loses every message, so the row goes. "Clear history" keeps the row: its last
  // message becomes the "history cleared" service message. Morse has no such message; the room stays listed on the
  // device that cleared it while the server's boundary is still the one that clear produced.
  keepsCleared(chatId: string, cutoff: MessagePosition): boolean {
    if (this.closed) return false
    const at = this.cleared.get(chatId)
    return this.clearing.has(chatId) || (at !== undefined && Math.abs(positionMilliseconds(cutoff) - at) < 1)
  }
  beginClear(chatId: string): void { if (!this.closed) this.clearing.add(chatId) }
  endClear(chatId: string): void { this.clearing.delete(chatId) }
  async noteCleared(chatId: string, cutoff: number): Promise<void> {
    if (this.closed || !Number.isFinite(cutoff) || cutoff <= 0) return
    this.cleared.set(chatId, cutoff)
    await this.store({ kind: 'cleared-chat-set', chatId, cutoff }).catch(() => {})
  }

  // The moment is never earlier than the last message it deletes: this computer's clock may run a
  // little behind the server's, and that message must not count as one that arrived afterwards.
  async hide(chatId: string, latest: MessagePosition | null = null): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    const before = this.at.get(chatId)
    if (this.state === 'reading') this.touched.add(chatId)
    this.at.set(chatId, Math.max(this.now(), latest ? Math.ceil(positionMilliseconds(latest)) : 0))
    try { await this.store({ kind: 'hidden-chat-set', chatId, on: true, at: this.at.get(chatId)! }) }
    catch {
      if (before === undefined) this.at.delete(chatId)
      else this.at.set(chatId, before)
      throw new Error(tr('대화를 목록에서 지우지 못했습니다.'))
    }
  }

  async restore(chatId: string): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    if (this.state === 'reading') this.touched.add(chatId)
    this.at.delete(chatId)
    await this.store({ kind: 'hidden-chat-set', chatId, on: false }).catch(() => {})
  }

  close(): void { this.closed = true }
}

// "나에게만 삭제" keeps the moment of deleting as this device's history boundary, over any the server
// sets, so a later message brings the room back with only what came after it.
export function withLocalDeletion(dialog: ReadDialog, deleted: MessagePosition | null): void {
  if (!deleted || (dialog.cutoff && comparePosition(dialog.cutoff, deleted) >= 0)) return
  dialog.cutoff = deleted
  if (!dialog.summary.top || comparePosition(dialog.summary.top, deleted) < 0) dialog.summary.preview = ''
}

// A private room whose history was deleted for everyone and that has nothing after that boundary has no last
// message: Telegram does not list such a chat (Postbox ChatListIndexTable.includedIndex returns nil without a top
// message; tdesktop History::shouldBeInChatList). iOS: MorseChatDialogMembership.shouldOmitRevokedDirectFromList.
// `revoked` is the server's boundary (chats/{id}.historyRevokedAt), not this device's own deletion moment.
export function emptyRevokedDirect(summary: DialogSummary, revoked: MessagePosition | null): boolean {
  return summary.kind === 'direct' && revoked !== null && (!summary.top || comparePosition(summary.top, revoked) < 0)
}
