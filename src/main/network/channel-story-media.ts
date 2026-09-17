import { createHash } from 'node:crypto'
import { object } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'

// Files of channel stories. Reading goes through authorizeMorseMediaRead, which checks the story document
// (not expired, not hidden from this person, and the channel public or this person its owner, admin or
// subscriber) before Storage answers; writing is the channel owner's, with ownerUid and storyId metadata as
// iOS StoryService.commitUpload sets them.
const grantURL = 'https://asia-northeast3-talky-a38c3.cloudfunctions.net/authorizeMorseMediaRead'

async function body(response: Response, max: number, signal: AbortSignal): Promise<Buffer> {
  const header = response.headers.get('content-length'), length = header === null ? null : Number(header)
  if (response.status !== 200 || !response.body || (length !== null && (!Number.isSafeInteger(length) || length <= 0 || length > max))) {
    await response.body?.cancel(); throw new Error('Invalid channel story response')
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      const part = await reader.read(); signal.throwIfAborted()
      if (part.done) break
      total += part.value.byteLength
      if (total > max) throw new Error('Channel story response too large')
      chunks.push(Buffer.from(part.value))
    }
    if (!total || (length !== null && total !== length)) throw new Error('Incomplete channel story response')
    return Buffer.concat(chunks, total)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(value => value.fill(0)) }
}

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
  const authorization = await auth.authorize(signal, false)
  signal.throwIfAborted()
  const resourceURL = `gs://${storageBucket}/${path}`
  const grant = await fetch(grantURL, {
    method: 'POST', signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
    body: JSON.stringify({ data: { resourceURL } })
  })
  const answer = await body(grant, 64 * 1024, signal)
  try {
    const wire = object(JSON.parse(answer.toString('utf8'))), result = object(wire.result ?? wire.data)
    if (wire.error !== undefined || result.ok !== true || result.resourceURL !== resourceURL) throw new Error('Channel story authorization denied')
  } finally { answer.fill(0) }
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}`
  const get = (url: string): Promise<Response> => fetch(url, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } })
  const info = await body(await get(endpoint), 64 * 1024, signal)
  let expected: { size: number; hash: string; contentType: string }
  try {
    const value = object(JSON.parse(info.toString('utf8'))), custom = object(value.metadata ?? {})
    if (value.bucket !== storageBucket || value.name !== path || custom.storyId !== storyId || custom.ownerUid !== authorId || !types.includes(String(value.contentType))
      || typeof value.size !== 'string' || !/^\d{1,10}$/.test(value.size) || Number(value.size) <= 0 || Number(value.size) > maxBytes
      || typeof value.md5Hash !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value.md5Hash)) throw new Error('Channel story metadata mismatch')
    expected = { size: Number(value.size), hash: value.md5Hash, contentType: String(value.contentType) }
  } finally { info.fill(0) }
  const bytes = await body(await get(`${endpoint}?alt=media`), expected.size, signal)
  if (bytes.length !== expected.size || createHash('md5').update(bytes).digest('base64') !== expected.hash) { bytes.fill(0); throw new Error('Channel story changed during download') }
  return { bytes, contentType: expected.contentType }
}

export { deleteStorageObject as deleteChannelStoryFile, uploadStorageObject as uploadChannelStoryFile } from './storage-object'
