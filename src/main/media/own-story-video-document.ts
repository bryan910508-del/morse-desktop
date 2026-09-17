import type { FirestoreDocument } from '../network/firestore-values'
import { ownStoryMediaPath } from './own-story-photo-document'
export function ownStoryVideoPath(doc: FirestoreDocument, uid: string): string {
  if (doc.fields.mediaType?.stringValue !== 'video') throw new Error('Story video presentation mismatch')
  return ownStoryMediaPath(doc.fields.mediaURL?.stringValue, uid)
}
