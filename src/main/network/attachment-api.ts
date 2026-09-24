import { object } from '../../shared/validation'
import { MessageMutationFailure, NotEmitted } from './contracts'
import type { ReadAuthorization, ReadCredentials } from './firestore-rpc'
import { tr } from '../../shared/i18n'

// 투표. 보낸 뒤에도 상태가 바뀌므로 서버 명령으로만 움직인다
// (MorseIOS firebase/functions/morse-release-authority.js). 규칙에서 클라이언트 쓰기는 전부 막혀 있다.
//
// 호출 방식은 반응 callable(message-reaction-api.ts)과 같다 — 같은 지역, 같은 두 헤더, 같은 본문 모양.
// 다른 점은 투표에는 소켓 경로가 없다는 것뿐이다. 반응만큼 잦지 않고, 집계와 표를 한 트랜잭션에
// 써야 해서 callable 하나가 더 단순하다.
const endpoint = 'https://asia-northeast3-talky-a38c3.cloudfunctions.net'
// 서버가 이 상태로 답하면 다시 보내도 같은 답이 온다. 그대로 사용자에게 알린다.
const definitiveStatuses = ['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'FAILED_PRECONDITION', 'NOT_FOUND', 'ALREADY_EXISTS']

async function readBounded(response: Response, failure: string): Promise<Record<string, unknown>> {
  if (!response.body) throw new MessageMutationFailure(failure)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new MessageMutationFailure(failure) }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  return object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

/** 서버 명령 하나를 부른다. 돌려주는 것은 함수의 result 다. */
export async function callMorseFunction(auth: ReadCredentials, name: string, payload: Record<string, unknown>,
  signal: AbortSignal, messages: { refused: string; uncertain: string }): Promise<Record<string, unknown>> {
  const bounded = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { authorization = await auth.authorize(bounded, false); bounded.throwIfAborted() }
  catch { throw new NotEmitted(tr('계정 연결을 확인하지 못했습니다.')) }
  const response = await fetch(`${endpoint}/${name}`, {
    method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
    body: JSON.stringify({ data: payload }),
  })
  const body = await readBounded(response, messages.uncertain)
  if (!response.ok || body.error !== undefined) {
    const error = object(body.error ?? {})
    const definitive = definitiveStatuses.includes(String(error.status))
    throw new MessageMutationFailure(definitive ? messages.refused : messages.uncertain, definitive)
  }
  const result = object(body.result ?? body.data)
  if (result.ok !== true) throw new MessageMutationFailure(messages.uncertain)
  return result
}

export interface PollVoteResult { optionIndexes: number[]; voteCounts: number[]; totalVoters: number; alreadyApplied: boolean }

/**
 * 표를 넣거나 거둔다. 빈 배열은 거두는 것이다.
 * `clientRevision` 은 반응과 같은 규약이다 — 같은 값으로 다시 보내면 서버가 두 번 세지 않는다.
 */
export async function setMessagePollVote(auth: ReadCredentials, uid: string, chatId: string, messageId: string,
  optionIndexes: number[], clientRevision: string, signal: AbortSignal): Promise<PollVoteResult> {
  const result = await callMorseFunction(auth, 'setMorseMessagePollVote',
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
  await callMorseFunction(auth, 'closeMorseMessagePoll', { chatId, messageId, expectedUid: uid }, signal,
    { refused: tr('투표를 닫을 수 없습니다.'), uncertain: tr('투표 닫기 결과를 확인하지 못했습니다.') })
}
