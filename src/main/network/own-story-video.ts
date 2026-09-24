import { createHash } from 'node:crypto'
import { object } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'
import { sendAgain } from './resend'

async function bytes(response: Response, max: number, signal: AbortSignal, validate: () => void, progress?: (loaded: number) => void): Promise<Buffer> {
  const header = response.headers.get('content-length'), length = header === null ? null : Number(header)
  if (response.status !== 200 || !response.body || (length !== null && (!Number.isSafeInteger(length) || length <= 0 || length > max))) {
    await response.body?.cancel(); throw new Error('Invalid story video response')
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let total = 0, lastProgress = 0
  try {
    while (true) {
      const part = await reader.read(); signal.throwIfAborted(); validate()
      if (part.done) break
      total += part.value.byteLength
      if (total > max) throw new Error('Story video response too large')
      chunks.push(Buffer.from(part.value))
      if (Date.now() - lastProgress >= 500) { progress?.(total); lastProgress = Date.now() }
    }
    if (!total || (length !== null && total !== length)) throw new Error('Incomplete story video response')
    return Buffer.concat(chunks, total)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
}
export async function downloadOwnStoryVideo(auth: ReadCredentials, path: string, storyId: string, uid: string, signal: AbortSignal, validate: () => void, maxBytes: number, progress: (loaded: number, total: number) => void): Promise<Buffer> {
  if (!path.startsWith(`stories/user/${uid}/`)) throw new Error('Story video scope mismatch')
  signal.throwIfAborted(); validate()
  const authorization = await auth.authorize(signal, false)
  signal.throwIfAborted(); validate()
  const resourceURL = `gs://${storageBucket}/${path}`
  const grant = await sendAgain(signal, () => fetch('https://asia-northeast3-talky-a38c3.cloudfunctions.net/authorizeMorseMediaRead', {
    method: 'POST', signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
    body: JSON.stringify({ data: { resourceURL } })
  }))
  const payload = await bytes(grant, 64 * 1024, signal, validate)
  try {
    const wire = object(JSON.parse(payload.toString('utf8'))), result = object(wire.result ?? wire.data)
    if (wire.error !== undefined || result.ok !== true || result.resourceURL !== resourceURL) throw new Error('Story video authorization denied')
  } finally { payload.fill(0) }
  signal.throwIfAborted(); validate()
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}`
  const get = (url: string) => sendAgain(signal, () => fetch(url, { signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } }))
  const metadata = async () => {
    signal.throwIfAborted(); validate()
    const payload = await bytes(await get(endpoint), 64 * 1024, signal, validate)
    try {
      const value = object(JSON.parse(payload.toString('utf8'))), custom = object(value.metadata)
      if (value.bucket !== storageBucket || value.name !== path || custom.storyId !== storyId || custom.ownerUid !== uid ||
          !['video/mp4', 'video/quicktime'].includes(String(value.contentType)) ||
          typeof value.size !== 'string' || !/^\d{1,10}$/.test(value.size) || Number(value.size) <= 0 || Number(value.size) > maxBytes ||
          typeof value.generation !== 'string' || !/^\d{1,30}$/.test(value.generation) ||
          typeof value.metageneration !== 'string' || !/^\d{1,30}$/.test(value.metageneration) ||
          typeof value.md5Hash !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value.md5Hash)) throw new Error('Story video metadata mismatch')
      return { contentType: value.contentType, size: Number(value.size), generation: value.generation, metageneration: value.metageneration, hash: value.md5Hash }
    } finally { payload.fill(0) }
  }
  const before = await metadata()
  progress(0, before.size)
  signal.throwIfAborted(); validate()
  const downloaded = await bytes(await get(`${endpoint}?alt=media`), Math.min(before.size, maxBytes), signal, validate, loaded => progress(loaded, before.size))
  try {
    const after = await metadata()
    if (JSON.stringify(before) !== JSON.stringify(after) || before.size !== downloaded.length ||
        createHash('md5').update(downloaded).digest('base64') !== before.hash) throw new Error('Story video changed during download')
    signal.throwIfAborted(); validate(); progress(downloaded.length, downloaded.length)
    return downloaded
  } catch (error) { downloaded.fill(0); throw error }
}
