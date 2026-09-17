import type { FirestoreDocument } from '../network/firestore-values'
import { ownStoryMediaPath } from './own-story-photo-document'
export function ownStoryAudioPath(doc: FirestoreDocument, uid: string): string {
  return ownStoryMediaPath(doc.fields.audioURL?.stringValue, uid)
}
