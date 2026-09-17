import { identifier, object } from './validation'
import { maxDialogAvatars } from './dialog-avatars'
import type { MessagePosition } from './model'
import { tr } from './i18n'

export interface ChannelSummary {
  id: string
  version: string | null
  publicSharing: { name: string; version: string } | null
  hasAvatar: boolean
  hasCover: boolean
  avatar: import('./group-photo').GroupPhotoImage | null
  cover: import('./group-photo').GroupPhotoImage | null
  status: 'loading' | 'ready' | 'unavailable' | 'error'
  access: import('./channel-access').ChannelAccessInfo | null
  editableAccess: import('./channel-access-edit').ChannelAccessSettings | null
  discussion: import('./channel-discussion-navigation').ChannelDiscussionReference | null
  tags: string[] | null
  name: string
  description: string
  ownerName: string
  owned: boolean
  subscriptionListed: boolean
  type: 'public' | 'private' | 'invite' | 'unknown'
  subscriberCount: number | null
  postCount: number | null
  updated: MessagePosition | null
}
export interface ChannelsSnapshot {
  status: 'idle' | 'loading' | 'ready' | 'error'
  message: string
  items: ChannelSummary[]
  admins: import('./channel-admins').ChannelAdminsSnapshot | null
  subscribers: import('./channel-subscribers').ChannelSubscribersSnapshot | null
  joinRequests: import('./channel-join-requests').ChannelJoinRequestsSnapshot | null
  membership: import('./channel-membership-info').ChannelMembershipSnapshot | null
  posts: import('./channel-posts').ChannelPostsSnapshot | null
}

export function visibleChannelPhotos(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > maxDialogAvatars) throw new Error(tr('표시할 채널 목록을 확인해 주세요.'))
  return [...new Set(raw.map(identifier))]
}

export interface ChannelCoverRequest { requestId: string; channelId: string }
export function channelCoverRequest(raw: unknown): ChannelCoverRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'channelId'].includes(key))) throw new Error(tr('채널 커버를 다시 선택해 주세요.'))
  return { requestId: identifier(value.requestId), channelId: identifier(value.channelId) }
}
