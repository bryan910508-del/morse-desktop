import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface PostRemovalResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export interface PostRemovalTarget { id: string; requestId: string; channelId: string; channelVersion: string; postId: string; revision: string }
export function postRemovalTarget(raw: unknown): PostRemovalTarget {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'channelId', 'channelVersion', 'postId', 'revision'].includes(k)) || typeof v.channelVersion !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.channelVersion) || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision)) throw new Error(tr('현재 본인 게시물과 채널을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), channelId: identifier(v.channelId), channelVersion: v.channelVersion, postId: identifier(v.postId), revision: v.revision }
}
