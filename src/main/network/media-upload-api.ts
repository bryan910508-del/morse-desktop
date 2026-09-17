import type { ReadCredentials } from './firestore-rpc'
import type { UploadDescriptor } from '../storage/upload-protocol'
import { storageBucket } from '../media/media-document'
import { object } from '../../shared/validation'

export class UploadFailure extends Error {
  constructor(readonly reason: 'upload-network' | 'upload-permission' | 'upload-conflict' | 'upload-expired' | 'upload-metadata') { super(reason) }
}
async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new UploadFailure('upload-metadata')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2 * 1024 * 1024) throw new UploadFailure('upload-metadata')
      chunks.push(chunk.value)
    }
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch { throw new UploadFailure('upload-metadata') }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
function sessionURL(raw: string, upload: UploadDescriptor): string {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' && url.host === 'firebasestorage.googleapis.com' && !url.username && !url.password && !url.hash &&
        url.pathname === `/v0/b/${storageBucket}/o` && url.searchParams.get('upload_id') &&
        (!url.searchParams.has('name') || url.searchParams.get('name') === upload.path)) return url.href
  } catch { /* reject before supplying credentials */ }
  throw new UploadFailure('upload-metadata')
}
function confirmedURL(raw: Record<string, unknown>, upload: UploadDescriptor, uid: string): string {
  const metadata = object(raw.metadata ?? {})
  if (raw.bucket !== storageBucket || raw.name !== upload.path || Number(raw.size) !== upload.size ||
      raw.contentType !== upload.contentType || raw.md5Hash !== upload.md5 || metadata.ownerUid !== uid ||
      metadata.morseUploadId !== upload.id || metadata.morseSourceSHA256 !== upload.sha256 || typeof raw.generation !== 'string') throw new UploadFailure('upload-conflict')
  // Same downloadURL contract used by the existing iOS sender. Never mint a
  // token or weaken Storage rules when the server omits it.
  const token = typeof raw.downloadTokens === 'string' ? raw.downloadTokens.split(',')[0]?.trim() : ''
  if (!token || token.length > 4096) throw new UploadFailure('upload-metadata')
  return `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(upload.path)}?alt=media&token=${encodeURIComponent(token)}`
}

export async function uploadAttachment(auth: ReadCredentials, uid: string, upload: UploadDescriptor, bytes: Buffer,
  saveSession: (url: string) => Promise<void>, progress: (loaded: number) => void, ownerSignal: AbortSignal, wasConfirmed = false): Promise<string> {
  const signal = AbortSignal.any([ownerSignal, auth.signal])
  const request = async (url: string, init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array }, callable = false): Promise<Response> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(65000)])
      const authorization = await auth.authorize(bounded, attempt > 0)
      bounded.throwIfAborted()
      const response = await fetch(url, { ...init, body: typeof init.body === 'string' ? init.body : init.body ? new Uint8Array(init.body) : undefined,
        signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { ...init.headers, Authorization: `${callable ? 'Bearer' : 'Firebase'} ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } })
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue }
      if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new UploadFailure('upload-permission') }
      return response
    }
    throw new UploadFailure('upload-network')
  }
  const preparation = await request('https://asia-northeast3-talky-a38c3.cloudfunctions.net/prepareMorseChatMedia', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { chatId: upload.chatId, expectedUid: uid } })
  }, true)
  if (!preparation.ok) { await preparation.body?.cancel(); throw new UploadFailure(preparation.status < 500 ? 'upload-permission' : 'upload-network') }
  const prepared = await json(preparation), result = object(prepared.result ?? prepared.data ?? {})
  if (prepared.error || result.ok !== true || result.chatId !== upload.chatId) throw new UploadFailure('upload-permission')
  const objectURL = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(upload.path)}`
  const metadata = async (): Promise<string | null> => {
    const response = await request(objectURL, { method: 'GET' })
    if (response.status === 404) { await response.body?.cancel(); return null }
    if (response.status !== 200) { await response.body?.cancel(); throw new UploadFailure('upload-network') }
    return confirmedURL(await json(response), upload, uid)
  }
  const existing = await metadata()
  if (existing) { progress(upload.size); return existing }
  if (wasConfirmed) throw new UploadFailure('upload-conflict')
  let url = upload.session ? sessionURL(upload.session, upload) : ''
  if (!url) {
    const start = await request(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodeURIComponent(upload.path)}`, {
      method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(upload.size), 'X-Goog-Upload-Header-Content-Type': upload.contentType, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name: upload.path, contentType: upload.contentType,
        metadata: { ownerUid: uid, morseUploadId: upload.id, morseSourceSHA256: upload.sha256, ...(upload.kind === 'file' ? { fileName: upload.name } : {}) } })
    })
    const raw = start.headers.get('X-Goog-Upload-URL')
    await start.body?.cancel()
    if (start.status !== 200 || start.headers.get('X-Goog-Upload-Status') !== 'active' || !raw) throw new UploadFailure('upload-network')
    url = sessionURL(raw, upload)
    // No bytes are issued until the resumable identity is durably committed.
    await saveSession(url)
  }
  signal.throwIfAborted()
  const query = await request(url, { method: 'POST', headers: { 'X-Goog-Upload-Command': 'query' } })
  const status = query.headers.get('X-Goog-Upload-Status'), received = query.headers.get('X-Goog-Upload-Size-Received')
  await query.body?.cancel()
  if (query.status === 404 || query.status === 410) throw new UploadFailure('upload-expired')
  if (query.status !== 200 || !['active', 'final'].includes(status ?? '') || received === null || !/^\d+$/.test(received)) throw new UploadFailure('upload-network')
  let offset = Number(received)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length || (status !== 'final' && offset !== bytes.length && offset % (256 * 1024) !== 0)) throw new UploadFailure('upload-conflict')
  progress(offset)
  if (status !== 'final') {
    while (true) {
      signal.throwIfAborted()
      const end = Math.min(bytes.length, offset + 1024 * 1024), final = end === bytes.length
      const part = await request(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': String(offset),
        'X-Goog-Upload-Command': end === offset ? 'finalize' : final ? 'upload, finalize' : 'upload' }, body: bytes.subarray(offset, end) })
      const uploadStatus = part.headers.get('X-Goog-Upload-Status')
      await part.body?.cancel()
      if (part.status === 404 || part.status === 410) throw new UploadFailure('upload-expired')
      if (part.status !== 200 || uploadStatus !== (final ? 'final' : 'active')) throw new UploadFailure('upload-network')
      offset = end; progress(offset)
      if (final) break
    }
  } else if (offset !== bytes.length) throw new UploadFailure('upload-conflict')
  const confirmed = await metadata()
  if (!confirmed) throw new UploadFailure('upload-metadata')
  signal.throwIfAborted()
  return confirmed
}
