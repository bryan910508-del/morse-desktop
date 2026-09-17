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
