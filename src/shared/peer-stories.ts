import { object, identifier } from './validation'
import type { StoryPrivacy } from './own-stories'
import { ownStoryPhotoRequest, type OwnStoryPhotoRequest, type OwnStoryPhotoSnapshot } from './own-story-photo'
import { ownStoryVideoRequest, type OwnStoryVideoRequest, type OwnStoryVideoSnapshot } from './own-story-video'
import { ownStoryAudioRequest, type OwnStoryAudioRequest } from './own-story-audio'
import { tr } from './i18n'

// B408 S2 (contracts/B408-stories-access.md §14): one person's stories as the server lets this account see them —
// this account's storyFeed first, and only when it holds none of theirs, getMorsePeerStories (iOS MorsePersonStories
// :20-24; tdesktop Data::Stories::requestPeerStories, data_stories.cpp:324-341). One way for every kind of audience.
export interface PeerStoriesRequest { id: string; ownerId: string }
export interface PeerStoryRow {
  id: string; version: string; caption: string; mediaType: 'image' | 'video' | 'unknown'; audio: 'none' | 'attached' | 'unknown'
  hasThumbnail: boolean; createdAt: number; expiresAt: number; privacy: StoryPrivacy
}
// What this account has read of them (storyReadMarks): the first story after it opens first.
export interface PeerStoriesResult {
  id: string; ownerId: string; outcome: 'ready' | 'unavailable'; rows: PeerStoryRow[]
  readUpTo: { createdAt: number; storyId: string } | null; observedAt: number; message: string
}
// One story of the open list: what is shown, read, reacted to, or whose link is opened.
export interface PeerStoryTarget { requestId: string; storyId: string; version: string }
export interface PeerStoryReaction extends PeerStoryTarget { emoji: string | null }
export interface PeerStoryLink extends PeerStoryTarget { url: string }
export type PeerStoryPhotoRequest = OwnStoryPhotoRequest
export interface PeerStoryPhotoSnapshot extends PeerStoryPhotoRequest { ownerId: string; media: OwnStoryPhotoSnapshot | null }
export type PeerStoryVideoRequest = OwnStoryVideoRequest
export interface PeerStoryVideoSnapshot extends PeerStoryVideoRequest { ownerId: string; media: OwnStoryVideoSnapshot | null }
export type PeerStoryPhotoAudioRequest = OwnStoryAudioRequest
export interface PeerStoryPhotoAudioSnapshot extends PeerStoryPhotoAudioRequest {
  ownerId: string; status: 'loading' | 'ready'; photoUrl: string | null; audioUrl: string | null; loaded: number; total: number | null; expiresAt: number
}
// MorseStoryReaction.allowed — the reactions any story takes, a person's or a channel's (the one list).
export const storyReactions = ['❤️', '👍', '🔥', '😂', '😮', '😢'] as const

const version = (raw: unknown): string => {
  if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('스토리를 다시 열어 주세요.'))
  return raw
}
export function peerStoriesRequest(raw: unknown): PeerStoriesRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'ownerId'].includes(key))) throw new Error(tr('스토리를 볼 사람을 다시 선택해 주세요.'))
  return { id: identifier(v.id), ownerId: identifier(v.ownerId) }
}
export function peerStoryTarget(raw: unknown, extra: string[] = []): PeerStoryTarget {
  const v = object(raw)
  if (Object.keys(v).some(key => !['requestId', 'storyId', 'version', ...extra].includes(key))) throw new Error(tr('스토리를 다시 열어 주세요.'))
  return { requestId: identifier(v.requestId), storyId: identifier(v.storyId), version: version(v.version) }
}
export function peerStoryReaction(raw: unknown): PeerStoryReaction {
  const v = object(raw), target = peerStoryTarget(raw, ['emoji'])
  if (v.emoji !== null && !(storyReactions as readonly unknown[]).includes(v.emoji)) throw new Error(tr('반응을 다시 선택해 주세요.'))
  return { ...target, emoji: v.emoji as string | null }
}
export function peerStoryLink(raw: unknown): PeerStoryLink {
  const v = object(raw), target = peerStoryTarget(raw, ['url'])
  if (typeof v.url !== 'string' || v.url.length > 4096) throw new Error(tr('링크를 다시 확인해 주세요.'))
  return { ...target, url: v.url }
}
export const peerStoryPhotoRequest = (raw: unknown): PeerStoryPhotoRequest => ownStoryPhotoRequest(raw)
export const peerStoryVideoRequest = (raw: unknown): PeerStoryVideoRequest => ownStoryVideoRequest(raw)
export const peerStoryPhotoAudioRequest = (raw: unknown): PeerStoryPhotoAudioRequest => ownStoryAudioRequest(raw)
