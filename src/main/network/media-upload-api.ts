import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import type { UploadDescriptor } from '../storage/upload-protocol'
import { storageBucket } from '../media/media-document'
import { object } from '../../shared/validation'
import { recordConnectionStep } from '../platform/connection-diagnostics'

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

// B185: a picture of up to this size goes in one request (the resumable protocol's last chunk may be any size); a larger
// file keeps 1 MiB chunks, so its progress moves and a lost connection resumes near where it stopped.
export const singleRequestBytes = 8 * 1024 * 1024
// B185 A5: how long each step of one upload took, one line in connection-check.log — no path, chat or token.
export function uploadTimingLine(steps: readonly [string, number][], size: number, requests: number): string {
  return `${steps.map(([name, ms]) => `${name}=${ms}`).join(' ')} total=${steps.reduce((sum, [, ms]) => sum + ms, 0)} kb=${Math.round(size / 1024)} req=${requests}`
}

export async function uploadAttachment(auth: ReadCredentials, uid: string, upload: UploadDescriptor, bytes: Buffer,
  saveSession: (url: string) => Promise<void>, progress: (loaded: number) => void, ownerSignal: AbortSignal, wasConfirmed = false): Promise<string> {
  const signal = AbortSignal.any([ownerSignal, auth.signal])
  const steps: [string, number][] = []
  let mark = Date.now(), requests = 0
  const lap = (name: string): void => { const now = Date.now(); steps.push([name, now - mark]); mark = now }
  const request = async (url: string, init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<Response> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(65000)])
      const authorization = await auth.authorize(bounded, attempt > 0)
      bounded.throwIfAborted()
      const response = await fetch(url, { ...init, body: typeof init.body === 'string' ? init.body : init.body ? new Uint8Array(init.body) : undefined,
        signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { ...init.headers, Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } })
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue }
      if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new UploadFailure('upload-permission') }
      requests++
      return response
    }
    throw new UploadFailure('upload-network')
  }
  // prepareMorseChatMedia checks the room and this account before any byte goes up. One that never left or whose
  // outcome is unknown is a network failure the queue resumes; an answer from the function is a refusal.
  let prepared: Record<string, unknown>
  try { prepared = await callMorseFunction(auth, 'prepareMorseChatMedia', { chatId: upload.chatId, expectedUid: uid }, signal, { limit: 2 * 1024 * 1024, refreshUnauthenticated: true }) }
  catch (error) { throw new UploadFailure(error instanceof MorseCallableFailure && error.delivery === 'answered' ? 'upload-permission' : 'upload-network') }
  if (prepared.ok !== true || prepared.chatId !== upload.chatId) throw new UploadFailure('upload-permission')
  lap('prepare')
  const objectURL = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(upload.path)}`
  const metadata = async (): Promise<string | null> => {
    const response = await request(objectURL, { method: 'GET' })
    if (response.status === 404) { await response.body?.cancel(); return null }
    if (response.status !== 200) { await response.body?.cancel(); throw new UploadFailure('upload-network') }
    return confirmedURL(await json(response), upload, uid)
  }
  // B185 A3: a send that has never started an upload session has put no byte up (the session is saved before the first
  // byte), so there is nothing to look for first; only a resumed one asks what is already there.
  const fresh = !upload.session && !wasConfirmed
  if (!fresh) {
    const existing = await metadata()
    lap('get')
    if (existing) { progress(upload.size); return existing }
    if (wasConfirmed) throw new UploadFailure('upload-conflict')
  }
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
    lap('start')
  }
  signal.throwIfAborted()
  // A session just started has received nothing; only one saved by an earlier attempt is asked how far it got.
  let status: string | null = 'active', received: string | null = '0'
  if (!fresh) {
    const query = await request(url, { method: 'POST', headers: { 'X-Goog-Upload-Command': 'query' } })
    status = query.headers.get('X-Goog-Upload-Status'); received = query.headers.get('X-Goog-Upload-Size-Received')
    await query.body?.cancel()
    if (query.status === 404 || query.status === 410) throw new UploadFailure('upload-expired')
    if (query.status !== 200 || !['active', 'final'].includes(status ?? '') || received === null || !/^\d+$/.test(received)) throw new UploadFailure('upload-network')
    lap('query')
  }
  let offset = Number(received)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length || (status !== 'final' && offset !== bytes.length && offset % (256 * 1024) !== 0)) throw new UploadFailure('upload-conflict')
  progress(offset)
  // The finishing request answers with the object's own metadata, its download token among them (the Storage REST
  // answer — what the iOS SDK reads too): checked as a separate read would be. Without it, the separate read.
  let confirmed: string | null = null
  if (status !== 'final') {
    const chunk = bytes.length <= singleRequestBytes ? bytes.length : 1024 * 1024
    while (true) {
      signal.throwIfAborted()
      const end = Math.min(bytes.length, offset + chunk), final = end === bytes.length
      const part = await request(url, { method: 'POST', headers: { 'X-Goog-Upload-Offset': String(offset),
        'X-Goog-Upload-Command': end === offset ? 'finalize' : final ? 'upload, finalize' : 'upload' }, body: bytes.subarray(offset, end) })
      const uploadStatus = part.headers.get('X-Goog-Upload-Status')
      if (part.status === 404 || part.status === 410) { await part.body?.cancel(); throw new UploadFailure('upload-expired') }
      if (part.status !== 200 || uploadStatus !== (final ? 'final' : 'active')) { await part.body?.cancel(); throw new UploadFailure('upload-network') }
      if (final) {
        // Anything short of a full match — no token, or a field this answer leaves out — is settled by the separate read.
        try { confirmed = confirmedURL(await json(part), upload, uid) } catch { confirmed = null }
      } else await part.body?.cancel()
      offset = end; progress(offset)
      if (final) break
    }
    lap('bytes')
  } else if (offset !== bytes.length) throw new UploadFailure('upload-conflict')
  if (!confirmed) {
    confirmed = await metadata()
    lap('meta')
  }
  if (!confirmed) throw new UploadFailure('upload-metadata')
  signal.throwIfAborted()
  recordConnectionStep('upload-timing', uploadTimingLine(steps, upload.size, requests))
  return confirmed
}
