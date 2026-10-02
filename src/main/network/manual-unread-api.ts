import { identifier } from '../../shared/validation'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import { tr } from '../../shared/i18n'

export class ManualUnreadFailure extends Error {
  constructor(readonly uncertain: boolean, message?: string) { super(message ?? (uncertain
    ? tr('읽음 표시의 저장 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다. 현재 상태를 확인해 주세요.')
    : tr('읽음 표시를 변경하지 못했습니다. 연결·권한과 최신 대화를 확인해 주세요.'))) }
}
export async function setManualUnread(auth: ReadCredentials, chatId: string, markedUnread: boolean, signal: AbortSignal, validate: () => void): Promise<void> {
  identifier(chatId)
  let result: Record<string, unknown>
  // The existing command has no operation ID, version or target cursor.
  // Only an outcome the request may have caused is uncertain: one that never left, or that the server refused, is not.
  try { result = await callMorseFunction(auth, 'setMorseChatUnread', { chatId, markedUnread }, signal, { validate, limit: 64 * 1024 }) }
  catch (error) { throw new ManualUnreadFailure(error instanceof MorseCallableFailure && error.uncertain) }
  if (result.ok !== true) throw new ManualUnreadFailure(true)
}
