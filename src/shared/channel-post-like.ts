import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelPostLikes { status: 'ready' | 'unknown' | 'inconsistent'; selected: boolean | null; count: number | null; storedCount: number | null; message: string }
export interface ChannelPostLikeRequest { id: string; requestId: string; channelId: string; postId: string; revision: string; selected: boolean; count: number; desired: boolean }
export interface ChannelPostLikeResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelPostLikeRequest(raw: unknown): ChannelPostLikeRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'requestId', 'channelId', 'postId', 'revision', 'selected', 'count', 'desired'].includes(key)) || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) ||
    typeof value.selected !== 'boolean' || typeof value.desired !== 'boolean' || value.selected === value.desired || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > 10000 || (value.selected && !value.count) || (value.desired && value.count >= 10000)) throw new Error(tr('최신 좋아요 상태를 확인하고 변경할 내용을 다시 선택해 주세요.'))
  return { id: identifier(value.id), requestId: identifier(value.requestId), channelId: identifier(value.channelId), postId: identifier(value.postId), revision: value.revision, selected: value.selected, desired: value.desired, count: value.count }
}
