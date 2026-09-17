import { documents, type WireObject } from './firestore-values'
import { storageBucket } from '../media/media-document'
import { channelStoryLifetime } from '../../shared/channel-stories'

// The writes StoryService makes on channels/{channelId}/stories, built apart so tests can send them through the
// real Firestore descriptor: an explicit time must be {seconds, nanos}, and a query limit an Int32Value.
const storyName = (channelId: string, storyId: string): string => `${documents}/channels/${channelId}/stories/${storyId}`
const ownKey = (uid: string): string => `\`${uid}\``

export function channelStoriesQuery(now: number, limit: number): WireObject {
  return {
    from: [{ collectionId: 'stories' }],
    where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'GREATER_THAN', value: { timestampValue: { seconds: Math.floor(now / 1000), nanos: 0 } } } },
    orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'ASCENDING' }, { field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
    limit: { value: limit }
  }
}
export function channelStoryCreateWrite(channelId: string, storyId: string, fields: Record<string, WireObject>): WireObject {
  return { update: { name: storyName(channelId, storyId), fields }, currentDocument: { exists: false } }
}
// StoryService.markViewed: viewerIds arrayUnion + viewedAtByUid.{uid} serverTimestamp.
export function channelStoryViewedWrite(channelId: string, storyId: string, uid: string): WireObject {
  return { transform: { document: storyName(channelId, storyId), fieldTransforms: [
    { fieldPath: 'viewerIds', appendMissingElements: { values: [{ stringValue: uid }] } },
    { fieldPath: `viewedAtByUid.${ownKey(uid)}`, setToServerValue: 'REQUEST_TIME' }
  ] }, currentDocument: { exists: true } }
}
// StoryService.setReaction: reactionByUid.{uid} set, or deleted when it is taken back.
export function channelStoryReactionWrite(channelId: string, storyId: string, uid: string, emoji: string | null): WireObject {
  const fields: Record<string, WireObject> = emoji === null ? {} : { reactionByUid: { mapValue: { fields: { [uid]: { stringValue: emoji } } } } }
  return { update: { name: storyName(channelId, storyId), fields }, updateMask: { fieldPaths: [`reactionByUid.${ownKey(uid)}`] }, currentDocument: { exists: true } }
}
export function channelStoryDeleteWrite(channelId: string, storyId: string): WireObject {
  return { delete: storyName(channelId, storyId) }
}

// StoryService.firestoreData for ownerType .channel: files under stories/channel/{channelId}/{storyId}, everyone's
// privacy, empty viewer and reaction maps, and a 24-hour expiry.
export function channelStoryFields(input: { channelId: string; storyId: string; uid: string; video: boolean; caption: string; durationSeconds: number | null; now: number }): Record<string, WireObject> {
  const at = (time: number): WireObject => ({ timestampValue: { seconds: Math.floor(time / 1000), nanos: (time % 1000) * 1_000_000 } })
  const base = `gs://${storageBucket}/stories/channel/${input.channelId}/${input.storyId}`, empty = (): WireObject => ({ mapValue: { fields: {} } })
  return {
    ownerType: { stringValue: 'channel' }, ownerId: { stringValue: input.channelId }, authorId: { stringValue: input.uid },
    mediaURL: { stringValue: `${base}${input.video ? '.mp4' : '.jpg'}` }, thumbnailURL: { stringValue: `${base}_thumb.jpg` },
    mediaType: { stringValue: input.video ? 'video' : 'image' }, createdAt: at(input.now), expiresAt: at(input.now + channelStoryLifetime),
    viewerIds: { arrayValue: { values: [] } }, privacy: { stringValue: 'everyone' }, hiddenFrom: { arrayValue: { values: [] } }, caption: { stringValue: input.caption },
    reactionByUid: empty(), viewedAtByUid: empty(), repostByUid: empty(), forwardByUid: empty(),
    ...(input.video && input.durationSeconds !== null ? { durationSeconds: { doubleValue: input.durationSeconds } } : {})
  }
}
