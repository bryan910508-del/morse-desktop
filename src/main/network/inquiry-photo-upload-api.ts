import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'
import { object } from '../../shared/validation'
import { maxInquiryPhotoBytes } from '../../shared/channel-inquiries'
import { tr } from '../../shared/i18n'

// ChannelInquiryChatView attachment send. iOS MorsePendingMediaUploadManager stores an inquiry
// attachment at inquiry_files/{inquiryId}/{messageId}.{ext} with the sender in ownerUid, which is
// what storage.rules checks (isInquiryParticipant + ownsNewObject, under 50 MB), and then puts the
// download URL in the message. A photo is re-encoded to JPEG first; a video keeps its container; a
// file travels as application/octet-stream with .bin, as iOS and the chat send it; a voice message is
// AAC in M4A, stored as audio/mp4 (an inquiry keeps its real type, unlike a chat's voice upload).
// storage.rules inquiry_files: the participants of the room, under 50 MB, whatever the object is. A picture this
// device composes is JPEG; one forwarded from elsewhere keeps the format it already has.
const inquiryAttachmentTypes: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', bin: 'application/octet-stream', m4a: 'audio/mp4' }
export function inquiryAttachmentPath(inquiryId: string, messageId: string, extension: string): string {
  if (!/^[A-Za-z0-9_-]{3,330}$/.test(inquiryId) || !inquiryId.includes('_') || !inquiryAttachmentTypes[extension] ||
      !/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(messageId)) throw new Error(tr('문의를 다시 열어 주세요.'))
  return `inquiry_files/${inquiryId}/${messageId}.${extension}`
}
export function inquiryPhotoPath(inquiryId: string, messageId: string): string { return inquiryAttachmentPath(inquiryId, messageId, 'jpg') }
export const maxInquiryAttachmentBytes = 50 * 1024 * 1024

async function json(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error(tr('업로드 응답을 확인하지 못했습니다.'))
  const reader = response.body.getReader(), parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 64 * 1024) throw new Error(tr('업로드 응답이 너무 큽니다.'))
      parts.push(part.value)
    }
    return object(JSON.parse(Buffer.concat(parts).toString('utf8')))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export interface InquiryPhotoUpload { inquiryId: string; messageId: string; bytes: Uint8Array; sha256: string; md5: string }
export type InquiryAttachmentExtension = 'jpg' | 'png' | 'webp' | 'gif' | 'mp4' | 'mov' | 'bin' | 'm4a'
export const inquiryAttachmentExtension = (raw: string): InquiryAttachmentExtension => {
  if (!Object.hasOwn(inquiryAttachmentTypes, raw)) throw new Error(tr('이 형식은 문의방으로 보낼 수 없습니다.'))
  return raw as InquiryAttachmentExtension
}
export interface InquiryAttachmentUpload extends InquiryPhotoUpload { extension: InquiryAttachmentExtension; noun: string }

export async function uploadInquiryPhoto(auth: ReadCredentials, uid: string, photo: InquiryPhotoUpload, signal: AbortSignal,
  progress: (value: number) => void, validate: () => void): Promise<string> {
  if (!photo.bytes.byteLength || photo.bytes.byteLength >= maxInquiryPhotoBytes) throw new Error(tr('10 MB 미만의 사진만 보낼 수 있습니다.'))
  return uploadInquiryAttachment(auth, uid, { ...photo, extension: 'jpg', noun: tr('사진') }, signal, progress, validate)
}

// One explicit send owns the upload: an interrupted attempt is repeated from the server's own
// offset while the same message id is in hand, and nothing is kept once the send is over.
export async function uploadInquiryAttachment(auth: ReadCredentials, uid: string, photo: InquiryAttachmentUpload, signal: AbortSignal,
  progress: (value: number) => void, validate: () => void): Promise<string> {
  const noun = photo.noun, contentType = inquiryAttachmentTypes[photo.extension]!
  if (!photo.bytes.byteLength || photo.bytes.byteLength >= maxInquiryAttachmentBytes) throw new Error(tr('50 MB 미만의 {0}만 보낼 수 있습니다.', [noun]))
  const path = inquiryAttachmentPath(photo.inquiryId, photo.messageId, photo.extension)
  const objectURL = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}`
  const request = async (url: string, init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array }): Promise<Response> => {
    validate(); signal.throwIfAborted()
    const bounded = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(65000)])
    const credentials = await auth.authorize(bounded, false)
    validate(); bounded.throwIfAborted()
    const response = await fetch(url, { ...init, body: typeof init.body === 'string' ? init.body : init.body ? new Uint8Array(init.body) : undefined,
      signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { ...init.headers,
        Authorization: `Firebase ${credentials.idToken}`, 'X-Firebase-AppCheck': credentials.appCheckToken } })
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new Error(tr('{0} 업로드 권한을 확인하지 못했습니다. 이 문의를 다시 열어 주세요.', [noun])) }
    return response
  }
  // The stored object must be this file, uploaded by this account, before its URL is sent.
  const uploaded = async (): Promise<string | null> => {
    const response = await request(objectURL, { method: 'GET' })
    if (response.status === 404) { await response.body?.cancel(); return null }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(tr('업로드된 {0} 정보를 확인하지 못했습니다.', [noun])) }
    const raw = await json(response), custom = object(raw.metadata)
    if (raw.bucket !== storageBucket || raw.name !== path || raw.contentType !== contentType ||
        Number(raw.size) !== photo.bytes.byteLength || raw.md5Hash !== photo.md5 ||
        custom.ownerUid !== uid || custom.morseSourceSHA256 !== photo.sha256) throw new Error(tr('업로드된 {0}의 내용이나 소유 정보가 다릅니다. 다시 선택해 주세요.', [noun]))
    const token = typeof raw.downloadTokens === 'string' ? raw.downloadTokens.split(',')[0]?.trim() : ''
    if (!token || token.length > 4096) throw new Error(tr('서버가 {0} URL을 제공하지 않았습니다. 접근 권한은 변경하지 않습니다.', [noun]))
    return `${objectURL}?alt=media&token=${encodeURIComponent(token)}`
  }
  const existing = await uploaded()
  if (existing) { progress(1); return existing }
  const start = await request(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(photo.bytes.byteLength), 'X-Goog-Upload-Header-Content-Type': contentType, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name: path, contentType, metadata: { ownerUid: uid, morseSourceSHA256: photo.sha256 } })
  })
  const session = start.headers.get('X-Goog-Upload-URL')
  await start.body?.cancel()
  if (start.status !== 200 || start.headers.get('X-Goog-Upload-Status') !== 'active' || !session) throw new Error(tr('{0} 업로드 준비 결과를 확인하지 못했습니다.', [noun]))
  const target = new URL(session)
  if (target.protocol !== 'https:' || target.host !== 'firebasestorage.googleapis.com' || target.username || target.password) throw new Error(tr('{0} 업로드 위치를 확인하지 못했습니다.', [noun]))
  let offset = 0
  while (true) {
    const end = Math.min(photo.bytes.byteLength, offset + 256 * 1024), final = end === photo.bytes.byteLength
    const part = await request(session, { method: 'POST', headers: { 'X-Goog-Upload-Offset': String(offset),
      'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload' }, body: photo.bytes.subarray(offset, end) })
    const state = part.headers.get('X-Goog-Upload-Status')
    await part.body?.cancel()
    if (part.status !== 200 || state !== (final ? 'final' : 'active')) throw new Error(tr('{0} 업로드가 중단되었습니다. 다시 보내 주세요.', [noun]))
    offset = end; progress(offset / photo.bytes.byteLength)
    if (final) break
  }
  const confirmed = await uploaded()
  if (!confirmed) throw new Error(tr('업로드된 {0}을(를) 확인하지 못했습니다.', [noun]))
  validate(); signal.throwIfAborted()
  return confirmed
}
