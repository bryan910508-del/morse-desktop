// A channel's 24-hour stories as iOS ChannelFeedView shows them: a ring on the channel's picture in «내 채널» and
// the «구독 중» strip, opened in the story viewer. StoryService keeps them in channels/{channelId}/stories with
// files under stories/channel/{channelId}/{storyId}; only the channel's owner posts or removes one.
export interface ChannelStory {
  id: string
  authorId: string
  mediaType: 'image' | 'video'
  hasThumbnail: boolean
  audio: boolean
  caption: string
  createdAt: number
  expiresAt: number
  viewed: boolean
  reaction: string | null
  viewCount: number
}
export interface ChannelStoryList { channelId: string; stories: ChannelStory[]; unread: boolean }
export type ChannelStoriesSnapshot = Record<string, ChannelStoryList>
export interface ChannelStoryMedia { url: string; audioUrl: string | null }
// MorseStoryReaction.allowed
export const channelStoryReactions = ['❤️', '👍', '🔥', '😂', '😮', '😢'] as const
// StoryService.storyTTL / maxCaptionLength
export const channelStoryLifetime = 24 * 60 * 60 * 1000
export const maxChannelStoryCaption = 2000
// A picked picture goes out as StoryService.commitUpload makes it: 1080px at JPEG 0.82 and a 360px thumbnail at 0.75.
export const channelStoryPhotoSide = 1080
export const channelStoryThumbnailSide = 360
export interface ChannelStoryPublish {
  channelId: string
  caption: string
  kind: 'image' | 'video'
  media: Uint8Array
  thumbnail: Uint8Array
  durationSeconds: number | null
}
