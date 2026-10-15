// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import type { StoryPrivacy } from '../../shared/own-stories'
import { identifier } from '../../shared/validation'
import { positionMilliseconds } from '../../shared/model'
import { documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'

// B408 S2 (contracts/B408-stories-access.md §9·§12·§14): the stories this account may see are the server's to choose —
// a copy of each in `users/{me}/storyFeed/{ownerId}_{storyId}` (morse-story-audience.js feedCopy :102-106: the story's
// fields without its viewers or hiddenFrom, and ownerType, ownerId, storyId, collection, storyPath, source, fedAt). As
// tdesktop takes the peers the server sends (Data::Stories::loadMore → stories.getAllStories, data_stories.cpp:720-728;
// updateStory :240), the row and a person's stories are read from that one place, never from the owner's own lists.
export type FeedCollection = 'stories' | 'publicStories' | 'closeFriendStories' | 'channel'
const privacyOf: Record<Exclude<FeedCollection, 'channel'>, StoryPrivacy> = { stories: 'contacts', publicStories: 'everyone', closeFriendStories: 'closeFriends' }
export interface FeedStory {
  ownerType: 'user' | 'channel'; ownerId: string; storyId: string; authorId: string; collection: FeedCollection; privacy: StoryPrivacy | 'channel'
  // The story document itself (users/{owner}/{collection}/{id} or channels/{id}/stories/{id}): where its views are written.
  storyPath: string; source: 'audience' | 'peer'; createdAt: number; expiresAt: number
  caption: string; mediaType: 'image' | 'video' | 'unknown'; hasThumbnail: boolean; audio: 'none' | 'attached' | 'unknown'
  mediaURL: string; thumbnailURL: string | null; audioURL: string | null; version: string
}
const text = (value: WireObject | undefined, max: number): string | null => {
  const raw = (value as { stringValue?: unknown } | undefined)?.stringValue
  return typeof raw === 'string' && raw.length <= max ? raw : null
}
// The path a story document of this owner, kind and collection must have.
export function storyDocumentPath(ownerType: 'user' | 'channel', ownerId: string, collection: FeedCollection, storyId: string): string {
  return ownerType === 'channel' ? `${documents}/channels/${ownerId}/stories/${storyId}` : `${documents}/users/${ownerId}/${collection}/${storyId}`
}

// Where this account's copy of an owner's story lives.
export const feedCopyPath = (uid: string, ownerId: string, storyId: string): string => `${documents}/users/${identifier(uid)}/storyFeed/${identifier(ownerId)}_${identifier(storyId)}`
// One copy in this account's feed. Anything that does not name itself as the place it lives in is not shown.
export function feedStoryFromDocument(doc: FirestoreDocument, uid: string): FeedStory {
  const f = doc.fields
  const ownerType = text(f.ownerType, 16), collection = text(f.collection, 32)
  if (ownerType !== 'user' && ownerType !== 'channel') throw new Error('Unknown story owner type')
  if (!collection || !['stories', 'publicStories', 'closeFriendStories', 'channel'].includes(collection) || (ownerType === 'channel') !== (collection === 'channel')) throw new Error('Unknown story collection')
  const ownerId = identifier(text(f.ownerId, 128)), storyId = identifier(text(f.storyId, 128))
  if (doc.name !== `${documents}/users/${uid}/storyFeed/${ownerId}_${storyId}`) throw new Error('Feed copy outside its place')
  const storyPath = text(f.storyPath, 512)
  const expected = storyDocumentPath(ownerType, ownerId, collection as FeedCollection, storyId)
  if (storyPath !== expected.slice(documents.length + 1) && storyPath !== expected) throw new Error('Feed copy names another story')
  const created = timestamp((f.createdAt as { timestampValue?: unknown } | undefined)?.timestampValue, storyId)
  const expires = timestamp((f.expiresAt as { timestampValue?: unknown } | undefined)?.timestampValue, storyId)
  const createdAt = positionMilliseconds(created), expiresAt = positionMilliseconds(expires)
  if (expiresAt <= createdAt) throw new Error('Invalid story expiry')
  const mediaURL = text(f.mediaURL, 10000)
  if (!mediaURL) throw new Error('Story without media')
  const caption = f.caption === undefined ? '' : text(f.caption, 8000)
  if (caption === null) throw new Error('Unsupported story caption')
  const media = text(f.mediaType, 16), thumbnailURL = text(f.thumbnailURL, 10000), audioURL = f.audioURL === undefined ? null : text(f.audioURL, 10000)
  return { ownerType, ownerId, storyId, authorId: identifier(text(f.authorId, 128)), collection: collection as FeedCollection, privacy: collection === 'channel' ? 'channel' : privacyOf[collection as Exclude<FeedCollection, 'channel'>],
    storyPath: expected, source: text(f.source, 16) === 'peer' ? 'peer' : 'audience', createdAt, expiresAt,
    caption, mediaType: media === 'image' ? 'image' : media === 'video' ? 'video' : 'unknown', hasThumbnail: Boolean(thumbnailURL),
    audio: f.audioURL === undefined ? 'none' : audioURL ? 'attached' : 'unknown', mediaURL, thumbnailURL: thumbnailURL || null, audioURL: audioURL || null,
    version: documentVersion(doc) }
}

// B408 §12-4: what this account has read of an owner's stories, the same for the three apps —
// `users/{me}/storyReadMarks/{ownerType}_{ownerId}` {ownerId, ownerType, maxReadCreatedAt, maxReadStoryId, updatedAt}
// (firestore.rules :1131-1143; iOS MorseStoryFeed.swift:15-35). tdesktop keeps one read-up-to per peer the same way
// (Data::Stories::markAsRead :1235, stories.readStories max_id :1409; updateReadStories :289).
export interface StoryReadMark { ownerType: 'user' | 'channel'; ownerId: string; maxReadCreatedAt: number; maxReadStoryId: string }
export const readMarkId = (ownerType: 'user' | 'channel', ownerId: string): string => `${ownerType}_${ownerId}`
export function storyReadMarkFromDocument(doc: FirestoreDocument, uid: string): StoryReadMark {
  const f = doc.fields, ownerType = text(f.ownerType, 16)
  if (ownerType !== 'user' && ownerType !== 'channel') throw new Error('Unknown read mark owner')
  const ownerId = identifier(text(f.ownerId, 128))
  if (doc.name !== `${documents}/users/${uid}/storyReadMarks/${readMarkId(ownerType, ownerId)}`) throw new Error('Read mark outside its place')
  const maxReadStoryId = identifier(text(f.maxReadStoryId, 128))
  const maxReadCreatedAt = positionMilliseconds(timestamp((f.maxReadCreatedAt as { timestampValue?: unknown } | undefined)?.timestampValue, maxReadStoryId))
  return { ownerType, ownerId, maxReadCreatedAt, maxReadStoryId }
}
// A story is read when it is not after the mark: older, or as old with an id not after the mark's.
export function storyRead(story: Pick<FeedStory, 'createdAt' | 'storyId'>, mark: Pick<StoryReadMark, 'maxReadCreatedAt' | 'maxReadStoryId'> | undefined): boolean {
  if (!mark) return false
  return story.createdAt < mark.maxReadCreatedAt || (story.createdAt === mark.maxReadCreatedAt && story.storyId <= mark.maxReadStoryId)
}
// The mark only moves forward.
export function laterMark(current: Pick<StoryReadMark, 'maxReadCreatedAt' | 'maxReadStoryId'> | undefined, story: Pick<FeedStory, 'createdAt' | 'storyId'>): boolean {
  return !storyRead(story, current)
}
