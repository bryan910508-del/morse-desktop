import type { GroupRemovalRequest } from '../../shared/group-removal'
import { identifier, object } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import { tr } from '../../shared/i18n'
export class GroupRemovalFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('참여자 제거 결과를 확인해야 합니다.') : tr('참여자 제거 요청이 거절되었습니다.')) } }
export async function removeGroupMember(auth: ReadCredentials, uid: string, request: GroupRemovalRequest, signal: AbortSignal, validate: () => void): Promise<void> {
  let result: Record<string, unknown>
  // Only an outcome the request may have caused is uncertain: one that never left, or that the server refused, is not.
  try { result = await callMorseFunction(auth, 'updateMorseGroupMembers', { chatId: request.chatId, removeUid: request.removeUid }, signal, { validate, limit: 1024 * 1024 }) }
  catch (error) { throw new GroupRemovalFailure(error instanceof MorseCallableFailure && error.uncertain) }
  try {
    if (result.ok !== true || !Array.isArray(result.participantUids) || result.participantUids.length < 1 || result.participantUids.length > 100) throw new Error('Invalid answer')
    const members = result.participantUids.map(identifier)
    if (new Set(members).size !== members.length || !members.includes(uid) || members.includes(request.removeUid)) throw new Error('Invalid answer')
    object(result.participantInfo)
  } catch { throw new GroupRemovalFailure(true) }
}
