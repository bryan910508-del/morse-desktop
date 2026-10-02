import type { GroupCreateRequest } from '../../shared/group-create'
import { identifier, object } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import { tr } from '../../shared/i18n'
export class GroupCreateFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('그룹 생성 결과를 확인해야 합니다.') : tr('그룹 생성 요청이 거절되었습니다.')) } }
export async function createGroup(auth: ReadCredentials, uid: string, request: GroupCreateRequest, signal: AbortSignal, validate: () => void,
  autoDelete: { seconds: number } = { seconds: 0 }): Promise<void> {
  let result: Record<string, unknown>
  // Only an outcome the request may have caused is uncertain: one that never left, or that the server refused, is not.
  try {
    result = await callMorseFunction(auth, 'createMorseGroup', { chatId: request.chatId, name: request.name, participantUids: [uid, ...request.participantUids],
      ...(autoDelete.seconds > 0 ? { autoDeleteSeconds: autoDelete.seconds, autoDeleteMyOnly: false } : {}) }, signal, { validate, limit: 1024 * 1024 })
  } catch (error) { throw new GroupCreateFailure(error instanceof MorseCallableFailure && error.uncertain) }
  try {
    const expected = [uid, ...request.participantUids].sort()
    if (result.chatId !== request.chatId || !Array.isArray(result.participantUids) || result.participantUids.length !== expected.length) throw new Error('Invalid answer')
    const members = result.participantUids.map(identifier).sort()
    if (members.some((id, index) => id !== expected[index])) throw new Error('Invalid answer')
    const info = object(result.participantInfo)
    for (const id of members) object(info[id])
  } catch { throw new GroupCreateFailure(true) }
}
