import { identifier, object } from './validation'
import { validChatTitle } from './chat-title'
import { tr } from './i18n'

export interface ChannelNameEdit { id: string; requestId: string; channelId: string; version: string; name: string }
export interface ChannelNameResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelNameEdit(raw: unknown): ChannelNameEdit {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'channelId', 'version', 'name'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
    !validChatTitle(value.name)) throw new Error(tr('최신 채널 정보를 확인하고 이름을 1~128자로 입력해 주세요.'))
  return { id: identifier(value.id), requestId: identifier(value.requestId), channelId: identifier(value.channelId), version: value.version, name: value.name.trim() }
}
