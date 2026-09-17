import { identifier, object } from './validation'
import { tr } from './i18n'

export const channelIntroductionLimit = 500
export interface ChannelIntroductionEdit { id: string; requestId: string; channelId: string; version: string; text: string }
export interface ChannelIntroductionResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelIntroductionEdit(raw: unknown): ChannelIntroductionEdit {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'channelId', 'version', 'text'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) ||
    typeof value.text !== 'string' || value.text.length > channelIntroductionLimit) throw new Error(tr('최신 채널 정보를 확인하고 소개를 500자 이내로 입력해 주세요.'))
  return { id: identifier(value.id), requestId: identifier(value.requestId), channelId: identifier(value.channelId), version: value.version, text: value.text.trim() }
}
