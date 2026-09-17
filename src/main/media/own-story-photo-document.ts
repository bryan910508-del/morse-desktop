import type { FirestoreDocument } from '../network/firestore-values'
import type { OwnStoryPhotoRequest } from '../../shared/own-story-photo'
import { storageBucket } from './media-document'
export function ownStoryMediaPath(raw: unknown, uid: string): string {
  if (typeof raw !== 'string' || !raw || raw.length > 10000) throw new Error('Unsupported story media source')
  let path: string
  if (raw.startsWith(`gs://${storageBucket}/`)) path = raw.slice(storageBucket.length + 6)
  else {
    const url = new URL(raw), prefix = `/v0/b/${storageBucket}/o/`
    if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.username || url.password || url.hash || !url.pathname.startsWith(prefix)) throw new Error('Unsupported story media URL')
    path = decodeURIComponent(url.pathname.slice(prefix.length))
  }
  const parts = path.split('/')
  if (path.length > 1024 || parts.length !== 4 || parts[0] !== 'stories' || parts[1] !== 'user' || parts[2] !== uid || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\x7f\\?#]/.test(part))) throw new Error('Story media owner path mismatch')
  return path
}
export function ownStoryPhotoPath(doc: FirestoreDocument, uid: string, presentation: OwnStoryPhotoRequest['presentation']): string {
  const poster = presentation === 'video-poster'
  if (doc.fields.mediaType?.stringValue !== (poster ? 'video' : 'image')) throw new Error('Story photo presentation mismatch')
  const path = ownStoryMediaPath(doc.fields[poster ? 'thumbnailURL' : 'mediaURL']?.stringValue, uid)
  if (poster && ownStoryMediaPath(doc.fields.mediaURL?.stringValue, uid) === path) throw new Error('Video and thumbnail sources must differ')
  return path
}
