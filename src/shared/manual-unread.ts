import { identifier, object } from './validation'
import { tr } from './i18n'

// readToEnd false: only the mark goes (opening a chat, B104); absent: «읽음으로 표시» also reads to the newest message.
export interface ManualUnreadRequest { id: string; chatId: string; markedUnread: boolean; version: string; readToEnd?: false }
export interface ManualUnreadSnapshot {
  id: string; chatId: string; markedUnread: boolean
  state: 'saving' | 'saved' | 'rejected' | 'uncertain' | 'observed'
  checking: boolean; message: string
}
export function manualUnreadRequest(raw: unknown): ManualUnreadRequest {
  const value = object(raw)
  if (typeof value.markedUnread !== 'boolean' || typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) throw new Error(tr('최신 대화에서 읽음 표시를 다시 선택해 주세요.'))
  return { id: identifier(value.id), chatId: identifier(value.chatId), markedUnread: value.markedUnread, version: value.version }
}
export function effectiveUnreadCount(dialog: { unreadCount: number; markedUnread: boolean }): number {
  return Math.max(dialog.unreadCount, dialog.markedUnread ? 1 : 0)
}
// B104 (tdesktop: opening a chat clears its unread mark — history_widget.cpp:3442-3447, and so does reading it,
// history.cpp:2078-2080 → Histories::changeDialogUnreadMark, data_histories.cpp:516-527): an open chat drops
// «안 읽음 표시», whatever else is unread — only the mark goes (readToEnd false); reading moves the read position as
// before. A secret session and the memo space have no mark.
export function clearsUnreadMark(dialog: { id: string; kind: string; markedUnread: boolean }, uid: string): boolean {
  return dialog.markedUnread && dialog.kind !== 'secret' && dialog.id !== `memo_${uid}`
}
