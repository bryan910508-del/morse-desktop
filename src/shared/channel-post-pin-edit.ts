import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface ChannelPostPinTarget { postId: string; revision: string }
export interface ChannelPostPinEdit { id: string; requestId: string; channelId: string; channelVersion: string; previous: ChannelPostPinTarget | null; next: ChannelPostPinTarget | null }
export interface ChannelPostPinResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
function target(raw: unknown): ChannelPostPinTarget | null {
  if (raw === null) return null
  const v = object(raw)
  if (Object.keys(v).some(k => !['postId', 'revision'].includes(k)) || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision)) throw new Error(tr('현재 고정 대상 게시물을 다시 확인해 주세요.'))
  return { postId: identifier(v.postId), revision: v.revision }
}
export function channelPostPinEdit(raw: unknown): ChannelPostPinEdit {
  const v = object(raw), previous = target(v.previous), next = target(v.next)
  if (Object.keys(v).some(k => !['id', 'requestId', 'channelId', 'channelVersion', 'previous', 'next'].includes(k)) || typeof v.channelVersion !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.channelVersion) || (!previous && !next) || previous?.postId === next?.postId) throw new Error(tr('변경할 고정 대상을 최신 목록에서 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), channelId: identifier(v.channelId), channelVersion: v.channelVersion, previous, next }
}
