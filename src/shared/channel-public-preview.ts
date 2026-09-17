import { identifier, object } from './validation'
import type { ChannelDiscoveryRow } from './channel-discovery'
import type { MessagePosition } from './model'
import { tr } from './i18n'
export interface PublicChannelPreviewRequest { requestId: string; searchRequestId: string; channelId: string; version: string }
export type PublicChannelMetadata = Omit<ChannelDiscoveryRow, 'matchesName' | 'matchesTag'> & { created: MessagePosition; ownerName: string | null; storedPostCount: number | null }
export interface PublicChannelPost { likes: import('./channel-post-like').ChannelPostLikes; media: import('./channel-post-media').ChannelPostMediaItem[]; id: string; revision: string; text: string; position: MessagePosition; hasMedia: boolean; mediaCount: number; likeCount: number | null; commentCount: number | null }
export interface PublicChannelPreviewSnapshot extends Omit<PublicChannelPreviewRequest, 'searchRequestId'> {
  photos: PublicChannelPhotosSnapshot | null
  linkedPostId: string | null
  searchRequestId: string | null
  membership: import('./channel-membership-info').ChannelMembershipSnapshot | null
  comments: import('./channel-comments').ChannelCommentsSnapshot | null
  media: import('./channel-post-media').ChannelPostMediaSnapshot | null
  status: 'loading' | 'ready' | 'blocked' | 'error'; metadata: PublicChannelMetadata | null; message: string
  postsRequested: boolean; postStatus: 'idle' | 'loading' | 'ready' | 'blocked' | 'error' | 'limit'; posts: PublicChannelPost[]; postMessage: string
}
export function publicChannelPreviewRequest(raw: unknown): PublicChannelPreviewRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'searchRequestId', 'channelId', 'version'].includes(k)) || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('최신 검색 결과에서 공개 채널을 다시 선택해 주세요.'))
  return { requestId: identifier(v.requestId), searchRequestId: identifier(v.searchRequestId), channelId: identifier(v.channelId), version: v.version }
}

export interface PublicChannelPhotosRequest { requestId: string; previewRequestId: string; channelId: string }
export interface PublicChannelPhotosSnapshot { requestId: string; avatar: import('./group-photo').GroupPhotoImage | null; cover: import('./group-photo').GroupPhotoImage | null }
export function publicChannelPhotosRequest(raw: unknown): PublicChannelPhotosRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['requestId', 'previewRequestId', 'channelId'].includes(key))) throw new Error(tr('현재 공개 채널에서 사진을 다시 선택해 주세요.'))
  return { requestId: identifier(v.requestId), previewRequestId: identifier(v.previewRequestId), channelId: identifier(v.channelId) }
}
