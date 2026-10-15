import type { ReadCredentials } from './firestore-rpc'
import { readGrantedStorageObject } from './granted-storage-read'
import { storageBucket } from '../media/media-document'

// Files of channel stories. Reading goes through authorizeMorseMediaRead, which checks the story document
// (not expired, not hidden from this person, and the channel public or this person its owner, admin or
// subscriber) before Storage answers; writing is the channel owner's, with ownerUid and storyId metadata as
// iOS StoryService.commitUpload sets them.

export function channelStoryPath(channelId: string, storyId: string, suffix: '.jpg' | '.mp4' | '_thumb.jpg'): string {
  return `stories/channel/${channelId}/${storyId}${suffix}`
}
// The object path of a gs:// address in this project's bucket under the channel's story folder.
export function channelStoryObject(address: string, channelId: string): string | null {
  const prefix = `gs://${storageBucket}/`
  if (!address.startsWith(prefix)) return null
  const path = address.slice(prefix.length), parts = path.split('/')
  return parts.length === 4 && parts[0] === 'stories' && parts[1] === 'channel' && parts[2] === channelId && /^[A-Za-z0-9_.-]{1,200}$/.test(parts[3]!) ? path : null
}

export async function downloadChannelStoryFile(auth: ReadCredentials, path: string, storyId: string, authorId: string, types: string[], maxBytes: number, signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string }> {
  // B416: the same read as every granted object — metadata and bytes together, kept only when size and md5 agree.
  return readGrantedStorageObject(auth, path, { label: 'Channel story', custom: { storyId, ownerUid: authorId }, contentTypes: types, maxBytes, resend: false }, signal, () => {}, () => {})
}

export { deleteStorageObject as deleteChannelStoryFile, uploadStorageObject as uploadChannelStoryFile } from './storage-object'
