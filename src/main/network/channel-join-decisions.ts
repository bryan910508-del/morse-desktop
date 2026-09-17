import type { ChannelJoinDecisionRequest } from '../../shared/channel-join-decisions'
import { identifier, object } from '../../shared/validation'
import { FirestoreReader, type ReadCredentials, type ReadAuthorization } from './firestore-rpc'
import { documents, stringField, documentVersion } from './firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelJoinDecisionFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('가입 처리 결과를 확인해야 합니다.') : tr('가입 처리를 시작하지 못했거나 서버가 거절했습니다.')) } }
export async function decideChannelJoin(auth: ReadCredentials, uid: string, request: ChannelJoinDecisionRequest, signal: AbortSignal, validate: () => void): Promise<void> {
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(150000)])
  let authorization: ReadAuthorization
  const reader = new FirestoreReader(auth)
  try {
    bounded.throwIfAborted(); validate()
    const path = `${documents}/channels/${request.channelId}`, channel = await reader.getDocument(path, bounded)
    if (!channel || channel.name !== path || documentVersion(channel) !== request.version || stringField(channel.fields, 'name', 512) !== request.title || stringField(channel.fields, 'ownerId', 160) !== uid || request.userId === uid) throw new Error('Owner selection changed')
    const joinPath = `${path}/joinRequests/${request.userId}`, pending = await reader.getDocument(joinPath, bounded)
    if (!pending || pending.name !== joinPath || documentVersion(pending) !== request.requestVersion || stringField(pending.fields, 'status', 32) !== 'pending' ||
      (pending.fields.uid !== undefined && stringField(pending.fields, 'uid', 160) !== request.userId)) throw new Error('Pending request changed')
    if (request.approved) {
      // Already-subscribed early returns do not consume the old pending request.
      if (await reader.getDocument(`${path}/subscribers/${request.userId}`, bounded)) throw new Error('Already subscribed')
      const raw = stringField(channel.fields, 'discussionChatId', 160)
      const chatId = raw ? identifier(raw) : `channel_discuss_${request.channelId}`
      const chatPath = `${documents}/chats/${chatId}`, chat = await reader.getDocument(chatPath, bounded)
      if (chat && (chat.name !== chatPath || stringField(chat.fields, 'type', 32) !== 'group' || chat.fields.isChannelDiscussion?.booleanValue !== true ||
        stringField(chat.fields, 'channelId', 160) !== request.channelId || stringField(chat.fields, 'createdBy', 160) !== uid)) throw new Error('Discussion identity changed')
    }
    bounded.throwIfAborted(); validate()
    authorization = await auth.authorize(bounded, false)
    bounded.throwIfAborted(); validate()
  } catch { throw new ChannelJoinDecisionFailure(false) }
  finally { reader.close() }
  // The existing callable has no request/version precondition. Read checks above
  // cannot prevent a different device from changing the target before its transaction.
  const callSignal = AbortSignal.any([bounded, AbortSignal.timeout(65000)])
  try {
    const response = await fetch('https://asia-northeast3-talky-a38c3.cloudfunctions.net/decideMorseChannelJoin', {
      method: 'POST', signal: callSignal, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
      body: JSON.stringify({ data: { channelId: request.channelId, userId: request.userId, approved: request.approved } })
    })
    if (!response.body) throw new ChannelJoinDecisionFailure(true)
    const body = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await body.read(); callSignal.throwIfAborted()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 64 * 1024) throw new ChannelJoinDecisionFailure(true)
        chunks.push(chunk.value)
      }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok || raw.error !== undefined) {
        const status = String(object(raw.error ?? {}).status)
        throw new ChannelJoinDecisionFailure(!['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(status))
      }
      const result = object(raw.result ?? raw.data)
      if (result.ok !== true || result.channelId !== request.channelId || (request.approved && result.status !== 'joined')) throw new ChannelJoinDecisionFailure(true)
    } finally { await body.cancel().catch(() => {}); body.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  } catch (error) { throw error instanceof ChannelJoinDecisionFailure ? error : new ChannelJoinDecisionFailure(true) }
}
