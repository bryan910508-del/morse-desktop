import { identifier, object } from './validation'
import { tr } from './i18n'

export const groupAnnouncementLimit = 4000
export interface GroupAnnouncementEdit { id: string; requestId: string; chatId: string; version: string; text: string }
export interface GroupAnnouncementResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function groupAnnouncementEdit(raw: unknown): GroupAnnouncementEdit {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'chatId', 'version', 'text'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
    typeof value.text !== 'string' || value.text.length > groupAnnouncementLimit) throw new Error(tr('최신 그룹 정보를 확인하고 소개를 4,000자 이내로 입력해 주세요.'))
  return { id: identifier(value.id), requestId: identifier(value.requestId), chatId: identifier(value.chatId), version: value.version, text: value.text.trim() }
}
