import type { ReadCredentials } from '../network/firestore-rpc'
import { storageBucket, type MediaResource } from './media-document'
import { tr } from '../../shared/i18n'
import { downloadChannelPostMedia } from '../network/channel-post-media'

export class MediaFailure extends Error {}
// Shared authenticated download for explicit viewing and forwarding. The
// caller resolves a current document; no bearer download URL enters this API.
export async function downloadMedia(credentials: ReadCredentials, resource: MediaResource, ownerSignal: AbortSignal,
  current: () => void, progress: (loaded: number, total: number | null) => void, maxBytes = 50 * 1024 * 1024): Promise<Buffer> {
  if (!resource.path || !resource.summary.available) throw new MediaFailure(tr('첨부 원본을 확인할 수 없습니다.'))
  const signal = AbortSignal.any([ownerSignal, credentials.signal, AbortSignal.timeout(120000)])
  const check = (): void => { signal.throwIfAborted(); current() }
  // storage.rules: a channel post's objects are read only after authorizeMorseMediaRead grants them.
  if (resource.grantPostId) {
    return downloadChannelPostMedia(credentials, resource.path, resource.grantPostId, signal, current, maxBytes,
      (loaded: number, total: number) => progress(loaded, total || null))
  }
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(resource.path)}?alt=media`
  let response: Response | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    const authorization = await credentials.authorize(signal, attempt > 0)
    check()
    response = await fetch(endpoint, { method: 'GET', signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: `Firebase ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken } })
    if (response.status !== 401 || attempt > 0) break
    await response.body?.cancel()
  }
  if (!response || response.status !== 200 || !response.body) {
    await response?.body?.cancel()
    throw new MediaFailure(response?.status === 403 || response?.status === 401 ? tr('첨부 접근 권한을 확인하지 못했습니다.') :
      response?.status === 404 ? tr('첨부 원본이 삭제되었거나 없습니다.') : tr('첨부를 불러오지 못했습니다. 다시 시도해 주세요.'))
  }
  const declared = response.headers.get('content-length'), total = declared !== null && /^\d+$/.test(declared) ? Number(declared) : null
  const limitMessage = tr('첨부 크기가 Desktop의 {0} MB 미만 제한을 벗어납니다.', [maxBytes / (1024 * 1024)])
  if (total !== null && (!Number.isSafeInteger(total) || total < 0 || (total === 0 && resource.summary.kind !== 'file') || total >= maxBytes)) {
    await response.body.cancel(); throw new MediaFailure(limitMessage)
  }
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let size = 0, lastProgress = 0, bytes: Buffer | null = null, retained = false
  try {
    check(); progress(0, total)
    while (true) {
      const chunk = await reader.read()
      check()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size >= maxBytes) throw new MediaFailure(limitMessage)
      chunks.push(Buffer.from(chunk.value))
      if (Date.now() - lastProgress >= 150) { progress(size, total); lastProgress = Date.now() }
    }
    if ((!size && resource.summary.kind !== 'file') || (total !== null && size !== total)) throw new MediaFailure(tr('첨부 다운로드가 끝나지 않았습니다. 다시 시도해 주세요.'))
    check(); bytes = Buffer.concat(chunks, size); progress(size, size); retained = true
    return bytes
  } finally {
    if (!retained) bytes?.fill(0)
    for (const chunk of chunks) chunk.fill(0)
    chunks.length = 0
    await reader.cancel().catch(() => {}); reader.releaseLock()
  }
}
