import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface PostVisibilityRequest { id: string; requestId: string; channelId: string; channelVersion: string; postId: string; revision: string; previous: 'public' | 'subscribers'; next: 'public' | 'subscribers'; publicChannel: boolean }
export interface PostVisibilityResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function postVisibilityRequest(raw: unknown): PostVisibilityRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'channelId', 'channelVersion', 'postId', 'revision', 'previous', 'next', 'publicChannel'].includes(k)) || typeof v.channelVersion !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.channelVersion) || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision) || (v.previous !== 'public' && v.previous !== 'subscribers') || (v.next !== 'public' && v.next !== 'subscribers') || v.previous === v.next || typeof v.publicChannel !== 'boolean') throw new Error(tr('현재 본인 게시물의 공개 범위를 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), channelId: identifier(v.channelId), channelVersion: v.channelVersion, postId: identifier(v.postId), revision: v.revision, previous: v.previous, next: v.next, publicChannel: v.publicChannel }
}
