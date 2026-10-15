import type { ReadCredentials } from './firestore-rpc'
import { readGrantedStorageObject } from './granted-storage-read'

// weighFirst: maxBytes is the person's automatic download limit (channel-post-pictures.ts), weighed before the bytes.
export async function downloadChannelPostMedia(auth: ReadCredentials, path: string, postId: string, signal: AbortSignal, validate: () => void, maxBytes: number, progress: (loaded: number, total: number) => void, weighFirst = false): Promise<Buffer> {
  const read = await readGrantedStorageObject(auth, path, { label: 'Channel media', custom: { postId }, contentTypes: null, maxBytes, resend: false, weighFirst }, signal, validate, progress)
  return read.bytes
}
