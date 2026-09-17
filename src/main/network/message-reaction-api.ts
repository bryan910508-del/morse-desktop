import { createHash } from 'node:crypto'
import { object } from '../../shared/validation'
import { MessageMutationFailure, NotEmitted } from './contracts'
import type { ReadAuthorization, ReadCredentials } from './firestore-rpc'
import type { StoredMessageAction } from '../storage/message-action-protocol'
import { tr } from '../../shared/i18n'

export function selectionDigest(reactions: string[]): string { return createHash('sha256').update(JSON.stringify(reactions)).digest('hex') }

export async function setMessageReaction(auth: ReadCredentials, uid: string, action: StoredMessageAction, signal: AbortSignal): Promise<void> {
  const bounded = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { authorization = await auth.authorize(bounded, false); bounded.throwIfAborted() }
  catch { throw new NotEmitted(tr('계정 연결을 확인하지 못했습니다.')) }
  const response = await fetch('https://asia-northeast3-talky-a38c3.cloudfunctions.net/setMorseMessageReaction', {
    method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
    body: JSON.stringify({ data: { chatId: action.chatId, messageId: action.messageId, expectedUid: uid,
      reactionProtocolVersion: 2, clientRevision: action.id, reactions: action.reactions } }),
  })
  if (!response.body) throw new MessageMutationFailure(tr('반응 응답을 확인하지 못했습니다.'))
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new MessageMutationFailure(tr('반응 응답을 확인하지 못했습니다.')) }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const body = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (!response.ok || body.error !== undefined) {
    const error = object(body.error ?? {})
    const definitive = ['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'FAILED_PRECONDITION', 'NOT_FOUND', 'ALREADY_EXISTS'].includes(String(error.status))
    throw new MessageMutationFailure(definitive ? tr('반응을 적용할 수 없습니다. 대화 권한과 최신 메시지를 확인해 주세요.') : tr('반응 결과를 확인해야 합니다.'), definitive)
  }
  const result = object(body.result ?? body.data)
  if (result.ok !== true || result.chatId !== action.chatId || result.roomId !== action.chatId ||
      result.messageId !== action.messageId || result.actorUid !== uid || result.clientRevision !== action.id ||
      typeof result.reactionVersion !== 'number' || !Number.isSafeInteger(result.reactionVersion) || result.reactionVersion < 0) throw new MessageMutationFailure(tr('반응 저장 응답을 확인하지 못했습니다.'))
  const reactions = object(result.reactions)
  const selection = Object.entries(reactions).filter(([, users]) => Array.isArray(users) && users.includes(uid)).map(([emoji]) => emoji).sort()
  if (JSON.stringify(selection) !== JSON.stringify(action.reactions)) throw new MessageMutationFailure(tr('반응 저장 응답이 요청과 일치하지 않습니다.'))
}
