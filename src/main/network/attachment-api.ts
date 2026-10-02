import { MessageMutationFailure, NotEmitted } from './contracts'
import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import { tr } from '../../shared/i18n'

// 투표. 보낸 뒤에도 상태가 바뀌므로 서버 명령으로만 움직인다
// (MorseIOS firebase/functions/morse-release-authority.js). 규칙에서 클라이언트 쓰기는 전부 막혀 있다.
//
// 호출은 반응 callable(message-reaction-api.ts)과 같은 morse-callable.ts 를 쓴다 — 같은 지역, 같은 두 헤더,
// 같은 본문 모양, 같은 판정. 다른 점은 투표에는 소켓 경로가 없다는 것뿐이다. 반응만큼 잦지 않고, 집계와 표를
// 한 트랜잭션에 써야 해서 callable 하나가 더 단순하다.

/** 서버 명령 하나를 부른다. 돌려주는 것은 함수의 result 다. */
async function pollCommand(auth: ReadCredentials, name: string, payload: Record<string, unknown>,
  signal: AbortSignal, messages: { refused: string; uncertain: string }): Promise<Record<string, unknown>> {
  let result: Record<string, unknown>
  try { result = await callMorseFunction(auth, name, payload, signal, { limit: 2 * 1024 * 1024 }) }
  catch (error) {
    // 떠나지 않은 요청은 대기열이 연결을 기다려 같은 clientRevision 으로 다시 보낸다.
    if (!(error instanceof MorseCallableFailure) || error.delivery === 'not-sent') throw new NotEmitted(tr('계정 연결을 확인하지 못했습니다.'))
    // 서버는 왜 거절했는지 details.reason 에 적는다 (morse-release-authority.js pollFailure). 그 말을
    // 그대로 옮기면 「할 수 없습니다」 대신 무엇이 막았는지 말할 수 있다.
    if (error.delivery === 'answered') throw new MessageMutationFailure(refusalText(error.reason) || messages.refused, true)
    throw new MessageMutationFailure(messages.uncertain)
  }
  if (result.ok !== true) throw new MessageMutationFailure(messages.uncertain)
  return result
}

// 서버가 details.reason 에 적어 보내는 까닭들. 여기 없는 것은 뭉뚱그린 문구로 떨어진다.
function refusalText(raw: unknown): string {
  return ({
    POLL_CLOSED: tr('종료된 투표입니다.'),
    POLL_REVOTE_FORBIDDEN: tr('이 투표는 표를 바꿀 수 없습니다.'),
    POLL_ANONYMOUS: tr('익명 투표는 누가 골랐는지 볼 수 없습니다.'),
    POLL_ROOM_UNSUPPORTED: tr('이 대화에서는 투표를 쓸 수 없습니다.'),
    NOT_A_POLL: tr('투표가 아닌 메시지입니다.'),
    MESSAGE_DELETED: tr('삭제된 메시지입니다.'),
    MESSAGE_NOT_FOUND: tr('메시지를 찾을 수 없습니다.'),
    ROOM_NOT_FOUND: tr('대화를 찾을 수 없습니다.'),
    NOT_MEMBER: tr('이 대화의 참여자가 아닙니다.'),
    ACCOUNT_CHANGED: tr('계정이 변경되었습니다. 다시 시도해 주세요.')
  } as Record<string, string>)[typeof raw === 'string' ? raw : ''] ?? ''
}

export interface PollVoteResult { optionIndexes: number[]; voteCounts: number[]; totalVoters: number; alreadyApplied: boolean }

/**
 * 표를 넣거나 거둔다. 빈 배열은 거두는 것이다.
 * `clientRevision` 은 반응과 같은 규약이다 — 같은 값으로 다시 보내면 서버가 두 번 세지 않는다.
 */
export async function setMessagePollVote(auth: ReadCredentials, uid: string, chatId: string, messageId: string,
  optionIndexes: number[], clientRevision: string, signal: AbortSignal): Promise<PollVoteResult> {
  const result = await pollCommand(auth, 'setMorseMessagePollVote',
    { chatId, messageId, optionIndexes, clientRevision, expectedUid: uid }, signal,
    { refused: tr('투표할 수 없습니다. 대화 권한과 최신 메시지를 확인해 주세요.'), uncertain: tr('투표 결과를 확인하지 못했습니다.') })
  // 답이 이 요청의 것인지 본다. 반응 callable 과 같은 확인이다.
  if (result.chatId !== chatId || result.messageId !== messageId || result.actorUid !== uid) {
    throw new MessageMutationFailure(tr('투표 응답이 요청과 일치하지 않습니다.'))
  }
  const counts = Array.isArray(result.pollVoteCounts) ? result.pollVoteCounts.map(value => Math.max(0, Math.trunc(Number(value)) || 0)) : []
  const chosen = Array.isArray(result.optionIndexes) ? result.optionIndexes.map(value => Math.trunc(Number(value))).filter(Number.isInteger) : []
  return { optionIndexes: chosen, voteCounts: counts,
    totalVoters: Math.max(0, Math.trunc(Number(result.pollTotalVoters)) || 0), alreadyApplied: result.alreadyApplied === true }
}

/** 만든 사람만 닫을 수 있다. 닫히면 결과가 고정된다. */
export async function closeMessagePoll(auth: ReadCredentials, uid: string, chatId: string, messageId: string,
  signal: AbortSignal): Promise<void> {
  await pollCommand(auth, 'closeMorseMessagePoll', { chatId, messageId, expectedUid: uid }, signal,
    { refused: tr('투표를 닫을 수 없습니다.'), uncertain: tr('투표 닫기 결과를 확인하지 못했습니다.') })
}
