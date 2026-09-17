import type { GroupPhotoImage } from './group-photo'
import type { MessagePosition } from './model'
import { tr } from './i18n'

// iOS Models.swift ChannelCategory: raw value, emoji and channel.category.* title.
export const channelCategories = [
  { id: 'work', emoji: '💼', title: tr('직장') }, { id: 'student', emoji: '🎓', title: tr('학생') },
  { id: 'dating', emoji: '💑', title: tr('연애') }, { id: 'game', emoji: '🎮', title: tr('게임') },
  { id: 'music', emoji: '🎵', title: tr('음악') }, { id: 'food', emoji: '🍳', title: tr('맛집') },
  { id: 'fitness', emoji: '🏃', title: tr('운동') }, { id: 'book', emoji: '📚', title: tr('독서') },
  { id: 'movie', emoji: '🎬', title: tr('영화') }, { id: 'it', emoji: '💻', title: tr('IT') },
  { id: 'art', emoji: '🎨', title: tr('예술') }, { id: 'travel', emoji: '🌍', title: tr('여행') },
  { id: 'health', emoji: '💊', title: tr('건강') }, { id: 'finance', emoji: '💰', title: tr('재테크') },
  { id: 'pet', emoji: '🐕', title: tr('반려동물') }, { id: 'advice', emoji: '🤔', title: tr('고민/상담') },
  { id: 'free', emoji: '🎭', title: tr('익명 자유') }
] as const
export type ChannelCategoryId = typeof channelCategories[number]['id']
export function channelCategoryId(raw: unknown): ChannelCategoryId {
  const found = channelCategories.find(item => item.id === raw)
  if (!found) throw new Error(tr('카테고리를 다시 선택해 주세요.'))
  return found.id
}

// One channel as the channel tab shows it: the subscribed strip, a post header or a discover card.
export interface ChannelHomeChannel {
  id: string; name: string; description: string; subscriberCount: number | null
  avatar: GroupPhotoImage | null
  // A channel in the account's own list opens directly; any other opens its public preview.
  listed: boolean; owned: boolean
}
// The post's first picture (a video's thumbnail) with its size, as ChannelFeedTimelineCachedImage shows it.
export interface ChannelHomeImage { status: 'idle' | 'loading' | 'ready' | 'error'; url: string | null; width: number; height: number; video: boolean }
export interface ChannelHomePost {
  channelId: string; id: string; text: string; position: MessagePosition
  mediaCount: number; image: ChannelHomeImage | null
  likeCount: number | null; commentCount: number | null
  // Whether this account likes the post (ChannelPost.likedBy), null while the list cannot be read.
  liked: boolean | null
  visibility: 'public' | 'subscribers'; promoted: boolean
}
export interface ChannelHomeSnapshot {
  status: 'loading' | 'ready' | 'error'; message: string
  // ChannelFeedState: my channel row, the «구독 중» strip, boosted then recent posts.
  mine: ChannelHomeChannel | null
  subscribed: ChannelHomeChannel[]
  posts: ChannelHomePost[]
  channels: ChannelHomeChannel[]
  // ChannelExplorePane: promoted channels lead the recommended rail.
  discover: { status: 'loading' | 'ready' | 'error'; trending: ChannelHomeChannel[]; newest: ChannelHomeChannel[]; promoted: ChannelHomeChannel[] }
  category: { id: ChannelCategoryId; status: 'loading' | 'ready' | 'error'; channels: ChannelHomeChannel[] } | null
}
