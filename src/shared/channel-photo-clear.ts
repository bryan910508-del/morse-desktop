import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelPhotoClear { id: string; requestId: string; channelId: string; version: string; kind: 'avatar' | 'cover' }
export interface ChannelPhotoClearResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelPhotoClear(raw: unknown): ChannelPhotoClear {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'channelId', 'version', 'kind'].includes(key)) ||
    typeof value.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(value.version) || (value.kind !== 'avatar' && value.kind !== 'cover')) throw new Error(tr('최신 채널 사진 정보를 다시 열어 주세요.'))
  return { id: identifier(value.id), requestId: identifier(value.requestId), channelId: identifier(value.channelId), version: value.version, kind: value.kind as ChannelPhotoClear['kind'] }
}
