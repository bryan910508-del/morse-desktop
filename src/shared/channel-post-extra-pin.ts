import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface ChannelPostExtraPinRequest { id: string; requestId: string; channelId: string; channelVersion: string; referenceId: string | null; referenceSource: 'missing' | 'null' | 'empty' | 'value'; postId: string; revision: string }
export interface ChannelPostExtraPinResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelPostExtraPin(raw: unknown): ChannelPostExtraPinRequest {
  const v = object(raw), referenceId = v.referenceId === null ? null : identifier(v.referenceId), postId = identifier(v.postId)
  if (Object.keys(v).some(k => !['id', 'requestId', 'channelId', 'channelVersion', 'referenceId', 'referenceSource', 'postId', 'revision'].includes(k)) ||
    typeof v.channelVersion !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.channelVersion) || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision) ||
    !['missing', 'null', 'empty', 'value'].includes(String(v.referenceSource)) || (v.referenceSource === 'value') !== (referenceId !== null) || postId === referenceId) throw new Error(tr('현재 채널 대상과 별도의 고정 표시를 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), channelId: identifier(v.channelId), channelVersion: v.channelVersion, referenceId, referenceSource: v.referenceSource as ChannelPostExtraPinRequest['referenceSource'], postId, revision: v.revision }
}
