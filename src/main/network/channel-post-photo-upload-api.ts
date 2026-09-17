import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'
import { object } from '../../shared/validation'
import { channelPostPhotoPath } from '../../shared/channel-post-photo'
import { channelPostPhotoSession, type PostPhotoRecord } from '../storage/channel-post-creation-table'
import { tr } from '../../shared/i18n'

const chunkBytes = 256 * 1024
async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error(tr('사진 업로드 응답을 확인하지 못했습니다.'))
  const reader = response.body.getReader(), parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 64 * 1024) throw new Error(tr('사진 업로드 응답이 너무 큽니다.'))
      parts.push(part.value)
    }
    return object(JSON.parse(Buffer.concat(parts).toString('utf8')))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

// ChannelService.createPost uploads each image with ownerUid and postId metadata. Reading
// channel_posts needs a read grant, so the object is checked through the upload response;
// a repeated upload to the same path is the same image under the storage update rule.
export async function uploadChannelPostPhoto(auth: ReadCredentials, uid: string, target: { channelId: string; postId: string; sha256: string; md5: string },
  photo: PostPhotoRecord, signal: AbortSignal, saveSession: (session: string) => Promise<void>, validate: () => void): Promise<void> {
  const path = channelPostPhotoPath(target.channelId, photo.id), size = photo.bytes.byteLength
  const request = async (url: string, init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<Response> => {
    validate(); signal.throwIfAborted()
    const bounded = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(65000)])
    const credentials = await auth.authorize(bounded, false)
    validate(); bounded.throwIfAborted()
    const response = await fetch(url, { ...init, body: typeof init.body === 'string' ? init.body : init.body ? new Uint8Array(init.body) : undefined,
      signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { ...init.headers,
        Authorization: `Firebase ${credentials.idToken}`, 'X-Firebase-AppCheck': credentials.appCheckToken } })
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new Error(tr('사진 업로드 권한을 확인하지 못했습니다. 채널 권한과 연결을 확인해 주세요.')) }
    return response
  }
  let session = photo.session ? channelPostPhotoSession(photo.session, target.channelId, photo.id) : '', offset = 0
  if (session) {
    const query = await request(session, { method: 'POST', headers: { 'X-Goog-Upload-Command': 'query' } })
    const state = query.headers.get('X-Goog-Upload-Status'), received = query.headers.get('X-Goog-Upload-Size-Received')
    await query.body?.cancel()
    if ([404, 410].includes(query.status)) session = ''
    else {
      if (query.status !== 200 || !['active', 'final'].includes(state ?? '') || !received || !/^\d+$/.test(received)) throw new Error(tr('사진 업로드 위치를 확인하지 못했습니다.'))
      offset = Number(received)
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > size || (state !== 'final' && offset !== size && offset % chunkBytes)) throw new Error(tr('사진 업로드 위치가 사진 크기와 다릅니다.'))
      if (state === 'final') {
        if (offset !== size) throw new Error(tr('완료된 사진 크기가 다릅니다.'))
        return
      }
    }
  }
  if (!session) {
    const start = await request(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodeURIComponent(path)}`, {
      method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(size), 'X-Goog-Upload-Header-Content-Type': 'image/jpeg', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name: path, contentType: 'image/jpeg', metadata: { ownerUid: uid, postId: target.postId, channelId: target.channelId, morseUploadId: photo.id, morseSourceSHA256: target.sha256 } })
    })
    const raw = start.headers.get('X-Goog-Upload-URL')
    await start.body?.cancel()
    if (start.status !== 200 || start.headers.get('X-Goog-Upload-Status') !== 'active' || !raw) throw new Error(tr('사진 업로드를 시작하지 못했습니다.'))
    session = channelPostPhotoSession(raw, target.channelId, photo.id)
    await saveSession(session) // No bytes before the resumable identity is stored.
    offset = 0
  }
  while (true) {
    const end = Math.min(size, offset + chunkBytes), final = end === size
    const part = await request(session, { method: 'POST', headers: { 'X-Goog-Upload-Offset': String(offset),
      'X-Goog-Upload-Command': end === offset ? 'finalize' : final ? 'upload, finalize' : 'upload' }, body: photo.bytes.subarray(offset, end) })
    const uploaded = part.headers.get('X-Goog-Upload-Status')
    if (part.status !== 200 || uploaded !== (final ? 'final' : 'active')) { await part.body?.cancel(); throw new Error(tr('사진 업로드가 중단되었습니다. 연결을 확인한 뒤 다시 게시해 주세요.')) }
    if (!final) { await part.body?.cancel(); offset = end; continue }
    const stored = await json(part), custom = object(stored.metadata ?? {})
    if (stored.bucket !== storageBucket || stored.name !== path || stored.contentType !== 'image/jpeg' || Number(stored.size) !== size || stored.md5Hash !== target.md5 ||
      custom.ownerUid !== uid || custom.postId !== target.postId) throw new Error(tr('올린 사진의 내용이나 소유 정보가 다릅니다. 게시 기록을 닫고 다시 시도해 주세요.'))
    break
  }
  validate(); signal.throwIfAborted()
}
