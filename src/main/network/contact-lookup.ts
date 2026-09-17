import { identifier, object } from '../../shared/validation'
import { publicMorseId } from '../../shared/contacts'
import type { ReadCredentials } from './firestore-rpc'
import { tr } from '../../shared/i18n'

export interface PublicContact { uid: string; userId: string; displayName: string; photoURL: string }
export async function lookupContact(auth: ReadCredentials, publicId: string, owner: AbortSignal): Promise<PublicContact | null> {
  const signal = AbortSignal.any([auth.signal, owner, AbortSignal.timeout(35000)])
  const authorization = await auth.authorize(signal, false)
  signal.throwIfAborted()
  const response = await fetch('https://asia-northeast3-talky-a38c3.cloudfunctions.net/lookupUserByTalkyId', {
    method: 'POST', signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
    body: JSON.stringify({ data: { userId: publicMorseId(publicId), purpose: 'public' } })
  })
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(tr('ID 검색을 완료하지 못했습니다. 잠시 후 다시 검색해 주세요.')) }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read(); signal.throwIfAborted()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 64 * 1024) throw new Error(tr('검색 응답이 너무 큽니다.'))
      chunks.push(chunk.value)
    }
    const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    if (raw.error) throw new Error(tr('검색 응답 오류'))
    const result = object(raw.result ?? raw.data)
    if (result.found === false) return null
    if (result.found !== true || result.isPrivate === true || publicMorseId(result.userId) !== publicId) throw new Error(tr('검색 응답을 확인하지 못했습니다.'))
    if (typeof result.displayName !== 'string' || !result.displayName.trim() || result.displayName.length > 512 ||
      typeof result.photoURL !== 'string' || result.photoURL.length > 10000) throw new Error(tr('프로필 응답을 확인하지 못했습니다.'))
    return { uid: identifier(result.uid), userId: publicId, displayName: result.displayName.trim(), photoURL: result.photoURL }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
