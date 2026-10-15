import type { ReadCredentials } from './firestore-rpc'
import { readGrantedStorageObject } from './granted-storage-read'
import { recordStoryStep } from '../platform/story-diagnostics'

export async function downloadOwnStoryVideo(auth: ReadCredentials, path: string, storyId: string, uid: string, signal: AbortSignal, validate: () => void, maxBytes: number, progress: (loaded: number, total: number) => void): Promise<Buffer> {
  if (!path.startsWith(`stories/user/${uid}/`)) throw new Error('Story video scope mismatch')
  const read = await readGrantedStorageObject(auth, path, { label: 'Story video', custom: { storyId, ownerUid: uid }, contentTypes: ['video/mp4', 'video/quicktime'], maxBytes, resend: true },
    signal, validate, progress, marks => recordStoryStep('video-timing', marks))
  return read.bytes
}
