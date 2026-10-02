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
  // A1 §3-5: whether this account deletes others' posts and comments here — the owner, or an admin whose
  // canDeleteMessages is stored true. Its own it always may.
  moderates: boolean
}
