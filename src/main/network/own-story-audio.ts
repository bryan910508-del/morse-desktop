import type { ReadCredentials } from './firestore-rpc'
import { readGrantedStorageObject } from './granted-storage-read'
import { recordStoryStep } from '../platform/story-diagnostics'

export async function downloadOwnStoryAudio(auth: ReadCredentials, path: string, storyId: string, uid: string, signal: AbortSignal, validate: () => void, maxBytes: number, progress: (loaded: number, total: number) => void): Promise<{ bytes: Buffer; mime: string }> {
  if (!path.startsWith(`stories/user/${uid}/`)) throw new Error('Story audio scope mismatch')
  const read = await readGrantedStorageObject(auth, path, { label: 'Story audio', custom: { storyId, ownerUid: uid }, contentTypes: ['audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/x-caf'], maxBytes, resend: true },
    signal, validate, progress, marks => recordStoryStep('audio-timing', marks))
  return { bytes: read.bytes, mime: read.contentType }
}
