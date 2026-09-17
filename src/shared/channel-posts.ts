import type { ChannelPostMediaItem, ChannelPostMediaSnapshot } from './channel-post-media'
import type { MessagePosition } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'

export interface ChannelPostsRequest { requestId: string; channelId: string }
export interface ChannelPostText {
  removalEligible: boolean
  pinFlag: import('./channel-post-pins').ChannelPostPinFlag
  own: boolean
  editableText: string | null
  likes: import('./channel-post-like').ChannelPostLikes
  visibility: 'public' | 'subscribers'; id: string; revision: string; mediaCount: number; media: ChannelPostMediaItem[]; position: MessagePosition; text: string; hasMedia: boolean; pinned: boolean; likeCount: number | null; commentCount: number | null
}
export interface ChannelPostsSnapshot extends ChannelPostsRequest {
  authoring: import('./channel-post-authoring').ChannelPostAuthoring | null
  pins: import('./channel-post-pins').ChannelPostPinInfo | null
  comments: import('./channel-comments').ChannelCommentsSnapshot | null
  scope: 'public' | 'member' | null
  status: 'loading' | 'ready' | 'blocked' | 'error' | 'limit'
  posts: ChannelPostText[]
  media: ChannelPostMediaSnapshot | null
  message: string
}
export function channelPostsRequest(raw: unknown): ChannelPostsRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'channelId'].includes(key))) throw new Error(tr('채널을 다시 선택해 주세요.'))
  return { requestId: identifier(value.requestId), channelId: identifier(value.channelId) }
}
