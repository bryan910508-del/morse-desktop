// Portions of this file follow Telegram Desktop (https://github.com/telegramdesktop/tdesktop, 7.3.1),
// Copyright (c) 2014-2026 The Telegram Desktop Authors. Licensed under GPL-3.0-or-later; see LEGAL.
import { identifier } from '../../shared/validation'
import { documents, type WireObject } from './firestore-values'
import { readMarkId, storyDocumentPath, type FeedCollection, type FeedStory, type StoryReadMark } from './story-feed-document'

// B408 S2 (contracts/B408-stories-access.md §9·§14, firestore.rules storyViewWriteOk :640-649): what this account does
// with someone's story is its own `…/{storyId}/views/{me}` — viewedAt, reaction, repostedAt, forwardedAt only — written
// while the story is in its feed; never the story document. tdesktop sends the same straight away (stories.readStories /
// incrementStoryViews, data_stories.cpp:1394-1409·1440-1470; stories.sendReaction :1092-1098); iOS S2
// StoryService.swift:220-237·373-408.
const viewPath = (storyPath: string, uid: string): string => `${storyPath}/views/${identifier(uid)}`
// Seen: viewedAt at the server's time, the rest of the record kept (a set with merge).
export function storyViewedWrite(storyPath: string, uid: string): WireObject {
  return { update: { name: viewPath(storyPath, uid), fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: 'viewedAt', setToServerValue: 'REQUEST_TIME' }] }
}
// A reaction set, or taken back; taking one back never makes a record that was not there.
export function storyReactionWrite(storyPath: string, uid: string, emoji: string | null): WireObject {
  if (emoji !== null && (!emoji || emoji.length > 16)) throw new Error('Unsupported story reaction')
  return emoji === null
    ? { update: { name: viewPath(storyPath, uid), fields: {} }, updateMask: { fieldPaths: ['reaction'] }, currentDocument: { exists: true } }
    : { update: { name: viewPath(storyPath, uid), fields: { reaction: { stringValue: emoji } } }, updateMask: { fieldPaths: ['reaction'] } }
}
// The read mark, whole (iOS noteStoryRead: setData without merge); the caller moves it only forward.
export function storyReadMarkWrite(uid: string, mark: StoryReadMark): WireObject {
  const ms = Math.floor(mark.maxReadCreatedAt), seconds = Math.floor(ms / 1000), nanos = (ms - seconds * 1000) * 1e6
  return { update: { name: `${documents}/users/${identifier(uid)}/storyReadMarks/${readMarkId(mark.ownerType, mark.ownerId)}`, fields: {
    ownerId: { stringValue: identifier(mark.ownerId) }, ownerType: { stringValue: mark.ownerType },
    maxReadCreatedAt: { timestampValue: { seconds: String(seconds), nanos } }, maxReadStoryId: { stringValue: identifier(mark.maxReadStoryId) }
  } }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }
}

// getMorsePeerStories / getMorseChannelStories (morse-story-feed.js :247-258): {stories: [{id, collection, ...story}]}
// with every time as {_ms}; for someone else's stories no viewer fields. The ones returned are put in this account's
// feed by the server, so their views may be written.
const ms = (value: unknown): number | null => {
  const raw = typeof value === 'object' && value !== null ? (value as { _ms?: unknown })._ms : undefined
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}
const str = (value: unknown, max: number): string | null => typeof value === 'string' && value.length <= max ? value : null
export function callableStories(result: unknown, ownerType: 'user' | 'channel', ownerId: string): FeedStory[] {
  const list = typeof result === 'object' && result !== null ? (result as { stories?: unknown }).stories : undefined
  if (!Array.isArray(list) || list.length > 200) throw new Error('Unexpected stories answer')
  const out: FeedStory[] = []
  for (const raw of list) {
    try {
      const item = raw as Record<string, unknown>
      const storyId = identifier(item.id), collection = str(item.collection, 32) ?? (ownerType === 'channel' ? 'channel' : null)
      if (!collection || !['stories', 'publicStories', 'closeFriendStories', 'channel'].includes(collection) || (ownerType === 'channel') !== (collection === 'channel')) continue
      const createdAt = ms(item.createdAt), expiresAt = ms(item.expiresAt), mediaURL = str(item.mediaURL, 10000)
      if (createdAt === null || expiresAt === null || expiresAt <= createdAt || !mediaURL) continue
      const caption = item.caption === undefined ? '' : str(item.caption, 8000)
      if (caption === null) continue
      const authorId = identifier(item.authorId), media = str(item.mediaType, 16), thumbnailURL = str(item.thumbnailURL, 10000), audioURL = item.audioURL === undefined ? null : str(item.audioURL, 10000)
      out.push({ ownerType, ownerId, storyId, authorId, collection: collection as FeedCollection,
        privacy: collection === 'channel' ? 'channel' : collection === 'stories' ? 'contacts' : collection === 'publicStories' ? 'everyone' : 'closeFriends',
        storyPath: storyDocumentPath(ownerType, ownerId, collection as FeedCollection, storyId), source: 'peer', createdAt, expiresAt, caption,
        mediaType: media === 'image' ? 'image' : media === 'video' ? 'video' : 'unknown', hasThumbnail: Boolean(thumbnailURL),
        audio: item.audioURL === undefined ? 'none' : audioURL ? 'attached' : 'unknown', mediaURL, thumbnailURL: thumbnailURL || null, audioURL: audioURL || null,
        // No document of its own here: the version is when it was made, as a document's update time is written.
        version: `${Math.floor(createdAt / 1000)}:${Math.round(createdAt % 1000) * 1e6}` })
    } catch { /* A story the answer cannot describe is not shown. */ }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.storyId < b.storyId ? -1 : a.storyId > b.storyId ? 1 : 0))
}
