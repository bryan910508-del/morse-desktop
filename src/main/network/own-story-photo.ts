import type { ReadCredentials } from './firestore-rpc'
import { readGrantedStorageObject } from './granted-storage-read'
import { recordStoryStep } from '../platform/story-diagnostics'

export async function downloadOwnStoryPhoto(auth: ReadCredentials, path: string, storyId: string, uid: string, signal: AbortSignal, validate: () => void, maxBytes: number, progress: (loaded: number, total: number) => void): Promise<Buffer> {
  if (!path.startsWith(`stories/user/${uid}/`)) throw new Error('Story photo scope mismatch')
  // B416: how long each round trip of a story photo takes, for story-check.log (milliseconds, no identifiers).
  const read = await readGrantedStorageObject(auth, path, { label: 'Story photo', custom: { storyId, ownerUid: uid }, contentTypes: ['image/jpeg', 'image/png'], maxBytes, resend: true },
    signal, validate, progress, marks => recordStoryStep('photo-timing', marks))
  return read.bytes
}
