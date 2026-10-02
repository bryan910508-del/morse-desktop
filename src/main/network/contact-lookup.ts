import { identifier } from '../../shared/validation'
import { publicMorseId } from '../../shared/contacts'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction } from './morse-callable'
import { tr } from '../../shared/i18n'

export interface PublicContact { uid: string; userId: string; displayName: string; photoURL: string }
export async function lookupContact(auth: ReadCredentials, publicId: string, owner: AbortSignal): Promise<PublicContact | null> {
  let result: Record<string, unknown>
  try { result = await callMorseFunction(auth, 'lookupUserByTalkyId', { userId: publicMorseId(publicId), purpose: 'public' }, owner, { timeout: 35000, limit: 64 * 1024 }) }
  catch { throw new Error(tr('ID 검색을 완료하지 못했습니다. 잠시 후 다시 검색해 주세요.')) }
  if (result.found === false) return null
  if (result.found !== true || result.isPrivate === true || publicMorseId(result.userId) !== publicId) throw new Error(tr('검색 응답을 확인하지 못했습니다.'))
  if (typeof result.displayName !== 'string' || !result.displayName.trim() || result.displayName.length > 512 ||
    typeof result.photoURL !== 'string' || result.photoURL.length > 10000) throw new Error(tr('프로필 응답을 확인하지 못했습니다.'))
  return { uid: identifier(result.uid), userId: publicId, displayName: result.displayName.trim(), photoURL: result.photoURL }
}
