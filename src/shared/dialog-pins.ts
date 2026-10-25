import { identifier, object } from './validation'
import { tr } from './i18n'

export interface DialogPinRequest { id: string; chatId: string; pinned: boolean; version: string }
export interface DialogPinSnapshot {
  id: string; chatId: string; pinned: boolean
  state: 'saving' | 'saved' | 'rejected' | 'uncertain' | 'observed'
  checking: boolean; message: string
}
export function pinVersion(raw: unknown): string {
  if (typeof raw !== 'string' || (raw !== '' && !/^\d{1,12}:\d{1,9}$/.test(raw))) throw new Error(tr('최신 고정 상태를 다시 확인해 주세요.'))
  return raw
}
export function dialogPinRequest(raw: unknown): DialogPinRequest {
  const value = object(raw)
  if (typeof value.pinned !== 'boolean') throw new Error(tr('고정 작업을 다시 선택해 주세요.'))
  return { id: identifier(value.id), chatId: identifier(value.chatId), pinned: value.pinned, version: pinVersion(value.version) }
}

// B502: a new order of the pinned chats, top first, each with the rank it takes and the copy of its pin it was read
// from. The rows keep the ranks they held among themselves (or, when those cannot be told apart, take now − i as iOS
// handleTablePinnedReorder does), so a chat pinned later still goes on top. tdesktop saves the order once, when the
// row is let go (finishReorderPinned → savePinnedOrder, dialogs_inner_widget.cpp:2786-2790).
export const pinOrderLimit = 100
export interface DialogPinOrderRequest { id: string; chats: { chatId: string; version: string; rank: number }[] }
export function dialogPinOrderRequest(raw: unknown): DialogPinOrderRequest {
  const value = object(raw)
  if (!Array.isArray(value.chats) || !value.chats.length || value.chats.length > pinOrderLimit) throw new Error(tr('고정 순서를 다시 정해 주세요.'))
  const seen = new Set<string>()
  let above = Infinity
  const chats = value.chats.map(item => {
    const entry = object(item), chatId = identifier(entry.chatId), version = pinVersion(entry.version), rank = entry.rank
    // Every chat in the order is pinned already, so it has a pin copy; the ranks fall strictly, top first.
    if (!version || seen.has(chatId) || typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0 || rank > 1e12 || rank >= above) throw new Error(tr('고정 순서를 다시 정해 주세요.'))
    seen.add(chatId); above = rank
    return { chatId, version, rank }
  })
  return { id: identifier(value.id), chats }
}
