// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.2.8, 272f6f5c),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { comparePosition, positionAt, positionMilliseconds, withinCutoff, type DialogSummary, type MessagePosition } from '../../shared/model'
import type { HiddenChatCommand } from '../storage/hidden-chat-table'
import { boolField, documents, stringField, timestamp, type FirestoreDocument, type ReadDialog } from '../network/firestore-values'
import { identifier } from '../../shared/validation'
import { tr } from '../../shared/i18n'

// Telegram's "Delete chat" and "Clear history" for me only (B327, contracts/B327-clear-for-me-account.md). Telegram sends
// both to the server (messages.deleteHistory, just_clear for «clear history» — data/data_histories.cpp:887-897), and the
// account's other devices take them from the updates (api/api_updates.cpp:1906-1909). Morse keeps the boundary on the
// person's side, users/{uid}/historyClears, which only this account reads (setServer). What the device pressed is drawn
// at once from the boundary kept here (`local`) and goes to the server through the history-clear queue; the later of
// the two is the room's boundary for this account. A deleted chat (`removeRow`) stays out of the list until a message
// newer than its boundary arrives, which brings it back with only what came after; a cleared one stays listed.
//
// The local boundaries are read from this device once per session; the list is rebuilt when they arrive, and since a
// rebuild asks for them again, only the first ask reads. A deletion or restore made while that read is on its way is
// newer than what it brings back, so it is not overwritten. A boundary kept here before B327 is put in the queue once
// (`uploaded`).
export interface MyHistoryClear { cutoff: MessagePosition; removeRow: boolean }
interface LocalClear { at: number; removeRow: boolean; uploaded: boolean }

// users/{uid}/historyClears: {kind: 'chat'|'inquiry', roomId, cutoff, messageId, clearedAt, removeRow} (server
// morse-history-clear-for-me.js). The id is not taken apart; kind and roomId say which room.
export function decodeHistoryClears(rows: Iterable<FirestoreDocument>, uid: string): { chats: Map<string, MyHistoryClear>; inquiries: Map<string, MyHistoryClear> } {
  const chats = new Map<string, MyHistoryClear>(), inquiries = new Map<string, MyHistoryClear>()
  const prefix = `${documents}/users/${uid}/historyClears/`
  for (const doc of rows) {
    try {
      if (!doc.name.startsWith(prefix)) continue
      const f = doc.fields, kind = stringField(f, 'kind', 16), roomId = identifier(stringField(f, 'roomId', 160))
      const raw = f.cutoff?.timestampValue
      if (!raw || (kind !== 'chat' && kind !== 'inquiry')) continue
      const value = { cutoff: timestamp(raw, ''), removeRow: boolField(f, 'removeRow') }
      ;(kind === 'chat' ? chats : inquiries).set(roomId, value)
    } catch { /* A document that cannot be read says nothing. */ }
  }
  return { chats, inquiries }
}
const later = (a: MessagePosition | null, b: MessagePosition | null): MessagePosition | null => !a ? b : !b ? a : comparePosition(a, b) >= 0 ? a : b

export class HiddenChats {
  private readonly local = new Map<string, LocalClear>()
  private server = new Map<string, MyHistoryClear>()
  // The boundary this device cleared a room's history at for everyone ("대화 기록 삭제"); see keepsCleared.
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
    Promise.all([this.store<{ chatId: string; hiddenAt: number; removeRow?: boolean; uploaded?: boolean }[]>({ kind: 'hidden-chats-read' }),
      this.store<{ chatId: string; cutoff: number }[]>({ kind: 'cleared-chats-read' })]).then(([rows, clearedRows]) => {
      if (this.closed) return
      if (!Array.isArray(rows) || !Array.isArray(clearedRows)) throw new Error('Unreadable hidden chats')
      for (const row of rows) if (!this.touched.has(row.chatId)) this.local.set(row.chatId, { at: row.hiddenAt, removeRow: row.removeRow !== false, uploaded: row.uploaded === true })
      for (const row of clearedRows) if (!this.cleared.has(row.chatId)) this.cleared.set(row.chatId, row.cutoff)
      this.touched.clear()
      this.state = 'read'
      if (rows.length || clearedRows.length) this.arrived()
    }).catch(() => {
      // Until a read succeeds the list shows every room; the next rebuild asks again.
      if (!this.closed && this.state === 'reading') this.state = 'unread'
    })
  }

  // users/{uid}/historyClears as last received. True when it changed what this account sees.
  setServer(chats: Map<string, MyHistoryClear>): boolean {
    if (this.closed) return false
    const same = chats.size === this.server.size && [...chats].every(([id, value]) => {
      const known = this.server.get(id)
      return known && known.removeRow === value.removeRow && comparePosition(known.cutoff, value.cutoff) === 0
    })
    this.server = new Map(chats)
    return !same
  }

  // A boundary kept here that has not gone to the server yet (B327 §3-5): its moment in milliseconds.
  pendingUploads(): { chatId: string; at: number; removeRow: boolean }[] {
    if (this.closed || this.state !== 'read') return []
    return [...this.local].flatMap(([chatId, value]) => value.uploaded ? [] : [{ chatId, at: value.at, removeRow: value.removeRow }])
  }
  async markUploaded(chatId: string): Promise<void> {
    const value = this.local.get(chatId)
    if (this.closed || !value) return
    value.uploaded = true
    await this.store({ kind: 'hidden-chat-uploaded', chatId }).catch(() => {})
  }

  // The history boundary for a room on this account: a message at or before it is not shown. The one kept here sits just
  // past its moment, since that moment is the last message's (rounded up) and a boundary keeps what lies exactly on it.
  cutoff(chatId: string): MessagePosition | null {
    if (this.closed) return null
    const local = this.local.get(chatId)
    return later(local ? positionAt(Math.floor(local.at) + 1, '') : null, this.server.get(chatId)?.cutoff ?? null)
  }

  // Reading only: a deleted chat is left out while its last message is one that was deleted.
  hides(summary: DialogSummary): boolean {
    if (this.closed) return false
    const local = this.local.get(summary.id), server = this.server.get(summary.id)
    const gone = (cutoff: MessagePosition): boolean => !summary.top || withinCutoff(summary.top, cutoff)
    return Boolean((local?.removeRow && gone(positionAt(Math.floor(local.at) + 1, ''))) || (server?.removeRow && gone(server.cutoff)))
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

  // B327: the boundary is the last message the person saw (the server takes that message's own time), never this
  // computer's clock; a room with no message has nothing to clear but its row, kept from now.
  async hide(chatId: string, latest: MessagePosition | null = null, removeRow = true, uploaded = true): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    const before = this.local.get(chatId)
    if (this.state === 'reading') this.touched.add(chatId)
    const value: LocalClear = { at: latest ? Math.ceil(positionMilliseconds(latest)) : Math.floor(this.now()), removeRow, uploaded }
    this.local.set(chatId, value)
    try { await this.store({ kind: 'hidden-chat-set', chatId, on: true, at: value.at, removeRow, uploaded }) }
    catch {
      if (before === undefined) this.local.delete(chatId)
      else this.local.set(chatId, before)
      throw new Error(removeRow ? tr('대화를 목록에서 지우지 못했습니다.') : tr('대화 기록을 삭제하지 못했습니다.'))
    }
  }

  async restore(chatId: string): Promise<void> {
    if (this.closed) throw new Error(tr('계정이 변경되었습니다.'))
    if (this.state === 'reading') this.touched.add(chatId)
    this.local.delete(chatId)
    await this.store({ kind: 'hidden-chat-set', chatId, on: false }).catch(() => {})
  }

  close(): void { this.closed = true }
}

// «나에게만» keeps this account's boundary (HiddenChats.cutoff) over the room's own when it is later — the one place
// max(historyRevokedAt, my cutoff) is taken (B327 §3-4) — so a later message brings the room back with only what came
// after it.
export function withLocalDeletion(dialog: ReadDialog, deleted: MessagePosition | null): void {
  if (!deleted || (dialog.cutoff && comparePosition(dialog.cutoff, deleted) >= 0)) return
  dialog.cutoff = deleted
  if (!dialog.summary.top || withinCutoff(dialog.summary.top, deleted)) dialog.summary.preview = ''
}

// B474: once every boundary is on the row (the room's, a discussion's policy, then withLocalDeletion's), whether it
// covers the newest message — the one place DialogSummary.topCleared is decided. Telegram's cleared chat keeps its
// place with an empty item and no date (dialogs_layout.cpp:807); the row's line was emptied by the same boundary.
export function markClearedTop(dialog: ReadDialog): void {
  if (dialog.cutoff && dialog.summary.top && withinCutoff(dialog.summary.top, dialog.cutoff)) dialog.summary.topCleared = true
  else delete dialog.summary.topCleared
}

// A private room whose history was deleted for everyone and that has nothing after that boundary has no last
// message: Telegram does not list such a chat (Postbox ChatListIndexTable.includedIndex returns nil without a top
// message; tdesktop History::shouldBeInChatList). iOS: MorseChatDialogMembership.shouldOmitRevokedDirectFromList.
// `revoked` is the server's boundary (chats/{id}.historyRevokedAt), not this device's own deletion moment.
// `savedId` is this account's own Saved Messages room, which is never hidden by this rule: Telegram's
// list always holds it, and here the notes screen finds the room through the dialog list, so hiding an
// emptied one would leave «저장한 메시지» with nothing to open. Emptying it is an ordinary thing to do —
// iOS's «메시지 비우기» clears it on the server, which writes exactly the boundary this rule reads.
export function emptyRevokedDirect(summary: DialogSummary, revoked: MessagePosition | null, savedId = ''): boolean {
  if (savedId && summary.id === savedId) return false
  return summary.kind === 'direct' && revoked !== null && (!summary.top || withinCutoff(summary.top, revoked))
}
