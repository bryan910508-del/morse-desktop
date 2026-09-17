export type ChannelPostPinFlag = 'pinned' | 'unpinned' | 'missing' | 'unknown'
export interface ChannelPinReference { status: 'none' | 'known' | 'unknown'; postId: string | null; source: 'missing' | 'null' | 'empty' | 'value' | 'invalid' }
export interface ChannelPostPinInfo {
  owned: boolean
  channelVersion: string | null
  reference: ChannelPinReference
  targetFlag: ChannelPostPinFlag | 'unobserved' | null
  flaggedCount: number
  missingCount: number
  unknownCount: number
  comparison: 'compatible' | 'inconsistent' | 'unresolved' | 'unknown'
  message: string
}
