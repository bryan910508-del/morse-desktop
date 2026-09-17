import { identifier, object } from './validation'
import { tr } from './i18n'
export interface GroupPhotoRequest { requestId: string; chatId: string; version: string }
export interface GroupPhotoClear extends GroupPhotoRequest { id: string }
export interface GroupPhotoResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export interface GroupPhotoImage { status: 'idle' | 'loading' | 'ready' | 'error'; url: string | null; message: string }
export interface GroupPhotoSnapshot extends GroupPhotoImage { hasPhoto: boolean; canClear: boolean }
export function groupPhotoRequest(raw: unknown): GroupPhotoRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'chatId', 'version'].includes(key)) || typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version)) throw new Error(tr('최신 그룹 정보를 다시 열어 주세요.'))
  return { requestId: identifier(value.requestId), chatId: identifier(value.chatId), version: value.version }
}
export function groupPhotoClear(raw: unknown): GroupPhotoClear {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'chatId', 'version'].includes(key))) throw new Error(tr('사진 해제 내용을 다시 확인해 주세요.'))
  return { ...groupPhotoRequest({ requestId: value.requestId, chatId: value.chatId, version: value.version }), id: identifier(value.id) }
}
