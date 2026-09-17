import type { ChannelDiscussionReference } from './channel-discussion-navigation'
export interface ChannelPostAuthoring {
  channelId: string
  channelVersion: string
  role: 'owner' | 'administrator' | 'none'
  permission: 'allowed' | 'denied' | 'unknown'
  permissionSource: 'owner' | 'explicit-true' | 'explicit-false' | 'no-admin' | 'unknown'
  adminVersion: string | null
  discussion: ChannelDiscussionReference
  publicChannel: boolean | null
}
