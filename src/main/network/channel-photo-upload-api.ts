import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'
import { object } from '../../shared/validation'
import { channelPhotoUploadPath, channelPhotoUploadSession, channelPhotoUploadURL, type ChannelPhotoUploadRecord } from '../storage/channel-photo-upload-table'
import { tr } from '../../shared/i18n'

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

export async function uploadChannelPhoto(auth: ReadCredentials, uid: string, photo: ChannelPhotoUploadRecord, signal: AbortSignal,
  saveSession: (session: string) => Promise<void>, progress: (value: number) => void, validate: () => void): Promise<string> {
  const path = channelPhotoUploadPath(photo.channelId, photo.id, photo.kind), objectURL = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}`
  const request = async (url: string, init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<Response> => {
    validate(); signal.throwIfAborted()
    const bounded = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(65000)])
    const credentials = await auth.authorize(bounded, false)
    validate(); bounded.throwIfAborted()
    const response = await fetch(url, { ...init, body: typeof init.body === 'string' ? init.body : init.body ? new Uint8Array(init.body) : undefined,
      signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { ...init.headers,
        Authorization: `Firebase ${credentials.idToken}`, 'X-Firebase-AppCheck': credentials.appCheckToken } })
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new Error(tr('사진 업로드 권한을 확인하지 못했습니다. 계정 연결을 확인해 주세요.')) }
    return response
  }
  const metadata = async (): Promise<string | null> => {
    const response = await request(objectURL, { method: 'GET' })
    if (response.status === 404) { await response.body?.cancel(); return null }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(tr('업로드된 사진 정보를 확인하지 못했습니다.')) }
    const raw = await json(response), custom = object(raw.metadata)
    if (raw.bucket !== storageBucket || raw.name !== path || raw.contentType !== 'image/jpeg' || Number(raw.size) !== photo.bytes.byteLength ||
      raw.md5Hash !== photo.md5 || custom.ownerUid !== uid || custom.channelId !== photo.channelId || custom.morseUploadId !== photo.id || custom.morseSourceSHA256 !== photo.sha256 ||
      typeof raw.generation !== 'string' || !/^\d+$/.test(raw.generation)) throw new Error(tr('업로드된 사진의 내용이나 소유 정보가 다릅니다. 이 대기 작업을 정리한 뒤 다시 선택해 주세요.'))
    const token = typeof raw.downloadTokens === 'string' ? raw.downloadTokens.split(',')[0]?.trim() : ''
    if (!token || token.length > 4096) throw new Error(tr('서버가 사진 URL을 제공하지 않았습니다. 자동으로 접근 권한을 변경하지 않습니다.'))
    return channelPhotoUploadURL(`${objectURL}?alt=media&token=${encodeURIComponent(token)}`, photo.channelId, photo.id, photo.kind)
  }
  const existing = await metadata()
  if (existing) { progress(1); return existing }
  if (photo.url) throw new Error(tr('업로드했던 사진 파일이 없습니다. 이 대기 작업을 정리한 뒤 다시 선택해 주세요.'))
  let session = photo.session ? channelPhotoUploadSession(photo.session, photo.channelId, photo.id, photo.kind) : ''
  if (!session) {
    const start = await request(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodeURIComponent(path)}`, {
      method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(photo.bytes.byteLength), 'X-Goog-Upload-Header-Content-Type': 'image/jpeg', 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name: path, contentType: 'image/jpeg', metadata: { ownerUid: uid, channelId: photo.channelId, morseUploadId: photo.id, morseSourceSHA256: photo.sha256 } })
    })
    const raw = start.headers.get('X-Goog-Upload-URL')
    await start.body?.cancel()
    if (start.status !== 200 || start.headers.get('X-Goog-Upload-Status') !== 'active' || !raw) throw new Error(tr('사진 업로드 준비 결과를 확인하지 못했습니다.'))
    session = channelPhotoUploadSession(raw, photo.channelId, photo.id, photo.kind)
    await saveSession(session) // No bytes before durable resumable identity.
  }
  const query = await request(session, { method: 'POST', headers: { 'X-Goog-Upload-Command': 'query' } })
  const state = query.headers.get('X-Goog-Upload-Status'), received = query.headers.get('X-Goog-Upload-Size-Received')
  await query.body?.cancel()
  if ([404, 410].includes(query.status)) throw new Error(tr('사진 업로드 세션이 만료되었습니다. 이 대기 작업을 정리한 뒤 사진을 다시 선택해 주세요.'))
  if (query.status !== 200 || !['active', 'final'].includes(state ?? '') || !received || !/^\d+$/.test(received)) throw new Error(tr('업로드 위치를 확인하지 못했습니다.'))
  let offset = Number(received)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > photo.bytes.byteLength || (state !== 'final' && offset !== photo.bytes.byteLength && offset % (256 * 1024))) throw new Error(tr('업로드 위치가 사진 크기와 다릅니다.'))
  progress(offset / photo.bytes.byteLength)
  if (state !== 'final') {
    while (true) {
      const end = Math.min(photo.bytes.byteLength, offset + 256 * 1024), final = end === photo.bytes.byteLength
      const part = await request(session, { method: 'POST', headers: { 'X-Goog-Upload-Offset': String(offset),
        'X-Goog-Upload-Command': end === offset ? 'finalize' : final ? 'upload, finalize' : 'upload' }, body: photo.bytes.subarray(offset, end) })
      const uploaded = part.headers.get('X-Goog-Upload-Status')
      await part.body?.cancel()
      if (part.status !== 200 || uploaded !== (final ? 'final' : 'active')) throw new Error(tr('사진 업로드가 중단되었습니다. 업로드 계속을 선택하면 서버 위치부터 확인합니다.'))
      offset = end; progress(offset / photo.bytes.byteLength)
      if (final) break
    }
  } else if (offset !== photo.bytes.byteLength) throw new Error(tr('완료된 사진 크기가 다릅니다.'))
  const confirmed = await metadata()
  if (!confirmed) throw new Error(tr('업로드된 사진을 확인하지 못했습니다.'))
  validate(); signal.throwIfAborted()
  return confirmed
}
