import type { GroupMembersRequest } from '../../shared/group-members'
import { identifier, object } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import { tr } from '../../shared/i18n'
export class GroupMembersFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('참여자 추가 결과를 확인해야 합니다.') : tr('참여자 추가 요청이 거절되었습니다.')) } }
export async function addGroupMembers(auth: ReadCredentials, uid: string, request: GroupMembersRequest, signal: AbortSignal, validate: () => void): Promise<void> {
  let result: Record<string, unknown>
  // Only an outcome the request may have caused is uncertain: one that never left, or that the server refused, is not.
  try { result = await callMorseFunction(auth, 'updateMorseGroupMembers', { chatId: request.chatId, addUids: request.addUids }, signal, { validate, limit: 1024 * 1024 }) }
  catch (error) { throw new GroupMembersFailure(error instanceof MorseCallableFailure && error.uncertain) }
  try {
    if (result.ok !== true || !Array.isArray(result.participantUids) || result.participantUids.length < 2 || result.participantUids.length > 100) throw new Error('Invalid answer')
    const members = result.participantUids.map(identifier)
    if (new Set(members).size !== members.length || ![uid, ...request.addUids].every(id => members.includes(id))) throw new Error('Invalid answer')
    const info = object(result.participantInfo)
    for (const id of request.addUids) object(info[id])
  } catch { throw new GroupMembersFailure(true) }
}
