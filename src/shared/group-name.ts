import { identifier, object } from './validation'
import { tr } from './i18n'

export interface GroupNameEdit { id: string; requestId: string; chatId: string; version: string; name: string }
export interface GroupNameResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function groupNameEdit(raw: unknown): GroupNameEdit {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'chatId', 'version', 'name'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
    typeof value.name !== 'string' || !value.name.trim() || value.name.length > 50) throw new Error(tr('최신 그룹 정보를 확인하고 이름을 1~50자로 입력해 주세요.'))
  return { id: identifier(value.id), requestId: identifier(value.requestId), chatId: identifier(value.chatId), version: value.version, name: value.name.trim() }
}
