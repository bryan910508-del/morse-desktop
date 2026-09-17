import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface NotePinRequest { id: string; requestId: string; noteId: string; version: string; pinned: boolean; desired: boolean }
export interface NotePinResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function notePinRequest(raw: unknown): NotePinRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'noteId', 'version', 'pinned', 'desired'].includes(k)) || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version) || typeof v.pinned !== 'boolean' || typeof v.desired !== 'boolean' || v.pinned === v.desired) throw new Error(tr('현재 노트의 버전과 고정 여부를 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), noteId: identifier(v.noteId), version: v.version, pinned: v.pinned, desired: v.desired }
}
