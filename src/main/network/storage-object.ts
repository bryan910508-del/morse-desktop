import type { ReadCredentials } from './firestore-rpc'
import { storageBucket } from '../media/media-document'
import { tr } from '../../shared/i18n'

// One Storage object written with a resumable upload in 2 MB pieces (non-final pieces must be multiples of
// 256 KiB), carrying the custom metadata the Storage rules check (ownerUid and the owning record's id).
const piece = 8 * 262144

export async function uploadStorageObject(auth: ReadCredentials, path: string, bytes: Uint8Array, contentType: string, custom: Record<string, string>, signal: AbortSignal): Promise<void> {
  const send = async (url: string, headers: Record<string, string>, payload?: string | Uint8Array): Promise<Response> => {
    signal.throwIfAborted()
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(120000)]), credentials = await auth.authorize(bounded, false)
    const response = await fetch(url, { method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { ...headers, Authorization: `Firebase ${credentials.idToken}`, 'X-Firebase-AppCheck': credentials.appCheckToken },
      body: typeof payload === 'string' ? payload : payload ? new Uint8Array(payload) : undefined })
    if ([401, 403].includes(response.status)) { await response.body?.cancel(); throw new Error(tr('파일 업로드 권한을 확인하지 못했습니다.')) }
    return response
  }
  const start = await send(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o?name=${encodeURIComponent(path)}`, {
    'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
    'X-Goog-Upload-Header-Content-Type': contentType, 'Content-Type': 'application/json; charset=utf-8'
  }, JSON.stringify({ name: path, contentType, metadata: custom }))
  const session = start.headers.get('X-Goog-Upload-URL')
  await start.body?.cancel()
  if (start.status !== 200 || start.headers.get('X-Goog-Upload-Status') !== 'active' || !session?.startsWith('https://firebasestorage.googleapis.com/')) throw new Error(tr('파일 업로드를 시작하지 못했습니다.'))
  for (let offset = 0; offset < bytes.byteLength;) {
    const end = Math.min(bytes.byteLength, offset + piece), final = end === bytes.byteLength
    const response = await send(session, { 'X-Goog-Upload-Offset': String(offset), 'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload' }, bytes.subarray(offset, end))
    await response.body?.cancel()
    if (response.status !== 200 || response.headers.get('X-Goog-Upload-Status') !== (final ? 'final' : 'active')) throw new Error(tr('파일을 올리지 못했습니다.'))
    offset = end
  }
}

export async function deleteStorageObject(auth: ReadCredentials, path: string, signal: AbortSignal): Promise<void> {
  const credentials = await auth.authorize(signal, false)
  const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(path)}`, { method: 'DELETE', signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Firebase ${credentials.idToken}`, 'X-Firebase-AppCheck': credentials.appCheckToken } })
  await response.body?.cancel()
}
