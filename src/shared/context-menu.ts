import { identifier, object } from './validation'
import { pinVersion } from './dialog-pins'
import { tr } from './i18n'

export type ContextMenuTarget = { kind: 'dialog'; chatId: string; pinVersion: string; version: string } | { kind: 'message'; chatId: string; messageId: string; version: string; index?: number }
export type ContextMenuRequest = ContextMenuTarget & { id: string; x: number; y: number }
export type ContextMenuAction = 'copied' | 'open-dialog' | 'pin-dialog' | 'unpin-dialog' | 'check-dialog-pin' | 'mark-dialog-unread' | 'mark-dialog-read' | 'check-manual-unread' | 'edit' | 'delete' | 'reaction' | 'open-media' | 'reply' | 'forward' | 'select-messages'
export interface ContextMenuResult { id: string; action: ContextMenuAction }
export function contextMenuRequest(raw: unknown): ContextMenuRequest {
  const value = object(raw)
  if (!['dialog', 'message'].includes(String(value.kind)) || typeof value.x !== 'number' || typeof value.y !== 'number' ||
      !Number.isFinite(value.x) || !Number.isFinite(value.y) || Math.abs(value.x) > 100000 || Math.abs(value.y) > 100000) throw new Error(tr('메뉴 위치를 확인해 주세요.'))
  const common = { id: identifier(value.id), chatId: identifier(value.chatId), x: value.x, y: value.y }
  if (value.kind === 'dialog') return { ...common, kind: 'dialog', pinVersion: pinVersion(value.pinVersion), version: pinVersion(value.version) }
  if (typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
      (value.index !== undefined && (typeof value.index !== 'number' || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= 1000))) throw new Error(tr('최신 메시지를 다시 선택해 주세요.'))
  return { ...common, kind: 'message', messageId: identifier(value.messageId), version: value.version, ...(value.index !== undefined ? { index: value.index as number } : {}) }
}
