import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface ChannelPostPinResolution { id: string; requestId: string; channelId: string; channelVersion: string; postId: string; revision: string; action: 'restore' | 'clear' }
export interface ChannelPostPinResolutionResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelPostPinResolution(raw: unknown): ChannelPostPinResolution {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'channelId', 'channelVersion', 'postId', 'revision', 'action'].includes(k)) || typeof v.channelVersion !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.channelVersion) || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision) || !['restore', 'clear'].includes(String(v.action))) throw new Error(tr('현재 채널 지정 대상과 변경할 결과를 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), channelId: identifier(v.channelId), channelVersion: v.channelVersion, postId: identifier(v.postId), revision: v.revision, action: v.action as ChannelPostPinResolution['action'] }
}
