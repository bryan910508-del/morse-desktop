import { identifier, object } from './validation'
import { tr } from './i18n'

export interface ManualUnreadRequest { id: string; chatId: string; markedUnread: boolean; version: string }
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
