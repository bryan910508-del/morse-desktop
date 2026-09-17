import type { OwnStoryDetail, StoryPrivacy } from '../../shared/own-stories'
import { identifier } from '../../shared/validation'
import { childId, documents, documentVersion, timestamp, type FirestoreDocument } from './firestore-values'
export const ownStoryCollections: Record<StoryPrivacy, string> = { contacts: 'stories', everyone: 'publicStories', closeFriends: 'closeFriendStories' }
export function ownStoryFromDocument(doc: FirestoreDocument, uid: string, privacy: StoryPrivacy): OwnStoryDetail {
  const id = identifier(childId(doc.name, `${documents}/users/${uid}/${ownStoryCollections[privacy]}`)), f = doc.fields, version = documentVersion(doc)
  if (!version || f.authorId?.stringValue !== uid || (f.ownerId !== undefined && f.ownerId.stringValue !== uid) || (f.ownerType !== undefined && f.ownerType.stringValue !== 'user') || (f.privacy !== undefined && f.privacy.stringValue !== privacy)) throw new Error('Own story identity mismatch')
  const created = timestamp(f.createdAt?.timestampValue, id), expires = timestamp(f.expiresAt?.timestampValue, id)
  if (expires.seconds < created.seconds || (expires.seconds === created.seconds && expires.nanoseconds <= created.nanoseconds)) throw new Error('Invalid own story expiry')
  const caption = f.caption === undefined ? '' : f.caption.stringValue
  if (typeof caption !== 'string' || caption.length > 8000) throw new Error('Unsupported story caption')
  const mediaType = f.mediaType?.stringValue === 'image' ? 'image' : f.mediaType?.stringValue === 'video' ? 'video' : 'unknown'
  const thumbnail = f.thumbnailURL?.stringValue, hasThumbnail = typeof thumbnail === 'string' && thumbnail.length > 0 && thumbnail.length <= 10000
  const audio: OwnStoryDetail['audio'] = f.audioURL === undefined ? 'none' : typeof f.audioURL.stringValue === 'string' && f.audioURL.stringValue.length > 0 && f.audioURL.stringValue.length <= 10000 ? 'attached' : 'unknown'
  return { audio, hasThumbnail, id, version, privacy, caption, preview: caption.slice(0, 160).replace(/\s+/g, ' '), created, expires, mediaType }
}
