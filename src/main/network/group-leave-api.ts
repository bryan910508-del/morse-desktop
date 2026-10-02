import type { GroupLeaveRequest } from '../../shared/group-leave'
import { identifier, object } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import { tr } from '../../shared/i18n'
export class GroupLeaveFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('그룹 나가기 결과를 확인해야 합니다.') : tr('그룹 나가기 요청이 거절되었습니다.')) } }
export async function leaveGroup(auth: ReadCredentials, uid: string, request: GroupLeaveRequest, signal: AbortSignal, validate: () => void): Promise<void> {
  let result: Record<string, unknown>
  // Only an outcome the request may have caused is uncertain: one that never left, or that the server refused, is not.
  try { result = await callMorseFunction(auth, 'updateMorseGroupMembers', { chatId: request.chatId, removeUid: uid }, signal, { validate, limit: 1024 * 1024 }) }
  catch (error) { throw new GroupLeaveFailure(error instanceof MorseCallableFailure && error.uncertain) }
  try {
    if (result.ok !== true || !Array.isArray(result.participantUids) || result.participantUids.length > 100) throw new Error('Invalid answer')
    const members = result.participantUids.map(identifier)
    if (new Set(members).size !== members.length || members.includes(uid)) throw new Error('Invalid answer')
    object(result.participantInfo)
  } catch { throw new GroupLeaveFailure(true) }
}
