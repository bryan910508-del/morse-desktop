import { identifier, object } from './validation'
import { tr } from './i18n'

export interface ChannelMembershipRequest { requestId: string; channelId: string }
export interface ChannelMembershipInfo {
  administrator: boolean
  discussion: import('./channel-discussion-navigation').ChannelDiscussionReference
  notification: import('./channel-notification-info').ChannelNotificationInfo
  owned: boolean
  subscriber: boolean
  subscriptionListed: boolean
  joinRequest: 'none' | 'pending' | 'approved' | 'denied' | 'unknown'
}
export interface ChannelMembershipSnapshot extends ChannelMembershipRequest {
  status: 'loading' | 'ready' | 'error' | 'blocked'
  info: ChannelMembershipInfo | null
  message: string
}
export function channelMembershipRequest(raw: unknown): ChannelMembershipRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'channelId'].includes(key))) throw new Error(tr('채널 가입 상태를 다시 열어 주세요.'))
  return { requestId: identifier(value.requestId), channelId: identifier(value.channelId) }
}
