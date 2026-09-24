import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'
import { storyPhotoMime,storyPhotoMetadata, storyPhotoPath, storyPhotoSession, type StoryPhotoReceipt, type StoryPhotoUploadSource } from '../media/story-photo-upload-record'
import { sendAgain } from './resend'
import { recordStoryStep } from '../platform/story-diagnostics'
import { tr } from '../../shared/i18n'
export class StoryPhotoUploadBlocked extends Error { constructor(readonly reason: 'unknown' | 'expired') { super(reason === 'unknown' ? tr('서버의 완료 상태는 확인했지만 사진 완료 응답을 보관하지 못했습니다. 게시 가능 상태로 넘기지 않습니다.') : tr('업로드 세션이 만료되었습니다. 같은 경로에 새 업로드를 시작하지 않습니다.')) } }
async function metadata(response: Response): Promise<unknown> {
  if (!response.body) throw new Error(tr('사진 완료 응답이 없습니다.'))
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 65536) throw new Error(tr('사진 완료 응답이 너무 큽니다.')); chunks.push(item.value) }; return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
// undici says only «fetch failed»; what it was is in the cause, and that is what the log keeps.
async function fetched(url: string, init: RequestInit & { signal: AbortSignal }): Promise<Response> {
  try { return await sendAgain(init.signal, () => fetch(url, init), (code, attempt) => recordStoryStep('upload-resend', `${code} ${attempt}`)) }
  catch (error) {
    const cause = error instanceof Error && error.cause, code = cause && typeof cause === 'object' ? (cause as { code?: string }).code : undefined
    recordStoryStep('upload-fetch-failed', `${code ?? ''} ${cause instanceof Error ? cause.message : ''}`)
    throw error
  }
}
export async function uploadStoryPhoto(auth: ReadCredentials, photo: StoryPhotoUploadSource, outer: AbortSignal, saveSession: (session: string) => Promise<void>, progress: (bytes: number) => void, validate: () => void): Promise<StoryPhotoReceipt> {
  const { intent, part, transfer, bytes } = photo, path = storyPhotoPath(intent.ownerId, intent.id, part)
  if (transfer.state !== 'pending' || transfer.receipt) throw new Error(tr('현재 사진 업로드 기록을 확인해 주세요.'))
  const signal = AbortSignal.any([outer, auth.signal, AbortSignal.timeout(300000)])
  const request = async (url: string, headers: Record<string, string>, body?: string | Uint8Array): Promise<Response> => {
    validate(); signal.throwIfAborted()
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(65000)]), credentials = await auth.authorize(bounded, false)
    validate(); bounded.throwIfAborted()
    const response = await fetched(url, { method: 'POST', headers: { ...headers, Authorization: `Firebase ${credentials.idToken}`, 'X-Firebase-AppCheck': credentials.appCheckToken }, body: typeof body === 'string' ? body : body ? new Uint8Array(body) : undefined, signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store' })
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new Error(tr('사진 업로드 권한을 확인하지 못했습니다.')) }
    return response
  }
  let session = transfer.session ? storyPhotoSession(transfer.session, intent.ownerId, intent.id, part) : null
  if (!session) {
    const response = await request(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodeURIComponent(path)}`, { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength), 'X-Goog-Upload-Header-Content-Type': storyPhotoMime(part), 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ name: path, contentType: storyPhotoMime(part), metadata: { ownerUid: intent.ownerId, storyId: intent.id } }))
    const raw = response.headers.get('X-Goog-Upload-URL'), active = response.headers.get('X-Goog-Upload-Status')
    await response.body?.cancel()
    if (response.status !== 200 || active !== 'active') throw new Error(tr('사진 업로드 세션 시작 응답을 확인하지 못했습니다.'))
    session = storyPhotoSession(raw, intent.ownerId, intent.id, part)
    await saveSession(session) // No source bytes are sent before this durable identity.
  }
  const query = await request(session, { 'X-Goog-Upload-Command': 'query' }), status = query.headers.get('X-Goog-Upload-Status'), rawOffset = query.headers.get('X-Goog-Upload-Size-Received')
  await query.body?.cancel()
  if ([404, 410].includes(query.status)) throw new StoryPhotoUploadBlocked('expired')
  if (query.status !== 200 || !['active', 'final'].includes(status ?? '') || !rawOffset || !/^[0-9]{1,10}$/.test(rawOffset)) throw new Error(tr('서버 업로드 위치를 확인하지 못했습니다.'))
  let offset = Number(rawOffset)
  if (!Number.isSafeInteger(offset) || offset > bytes.byteLength || (status === 'active' && offset !== bytes.byteLength && offset % 262144 !== 0)) throw new Error(tr('서버 업로드 위치가 준비 사진과 다릅니다.'))
  if (status === 'final') throw new StoryPhotoUploadBlocked('unknown') // Query is not a metadata acknowledgement; prepublication GET is forbidden by the current contract.
  progress(offset)
  while (true) {
    const end = Math.min(bytes.byteLength, offset + 262144), final = end === bytes.byteLength
    const response = await request(session, { 'X-Goog-Upload-Offset': String(offset), 'X-Goog-Upload-Command': end === offset ? 'finalize' : final ? 'upload, finalize' : 'upload' }, bytes.subarray(offset, end))
    if (response.status !== 200 || response.headers.get('X-Goog-Upload-Status') !== (final ? 'final' : 'active')) { await response.body?.cancel(); throw new Error(tr('사진 전송 응답을 확인하지 못했습니다. 자동 반복하지 않습니다.')) }
    if (final) { const receipt = storyPhotoMetadata(await metadata(response), intent, part); validate(); signal.throwIfAborted(); progress(end); return receipt }
    await response.body?.cancel(); offset = end; progress(offset)
  }
}
