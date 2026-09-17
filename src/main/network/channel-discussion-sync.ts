import type { ReadAuthorization, ReadCredentials } from './firestore-rpc'
import { identifier, object } from '../../shared/validation'
import { ChannelAccessFailure } from './channel-access-write'
export async function syncChannelDiscussion(auth: ReadCredentials, channelId: string, phase: 'join' | 'sync', signal: AbortSignal, validate: () => void, expectedDiscussionId: string): Promise<void> {
  identifier(channelId); identifier(expectedDiscussionId)
  const bounded = AbortSignal.any([signal, auth.signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { bounded.throwIfAborted(); validate(); authorization = await auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
  catch { throw new ChannelAccessFailure(false) }
  try {
    const endpoint = phase === 'join' ? 'joinChannelDiscussion' : 'syncChannelDiscussionMembers'
    const response = await fetch(`https://asia-northeast3-talky-a38c3.cloudfunctions.net/${endpoint}`, { method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken }, body: JSON.stringify({ data: { channelId } }) })
    if (!response.body) throw new ChannelAccessFailure(true)
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const part = await reader.read(); bounded.throwIfAborted()
        if (part.done) break
        size += part.value.byteLength
        if (size > 65536) throw new ChannelAccessFailure(true)
        chunks.push(part.value)
      }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok || raw.error !== undefined) throw new ChannelAccessFailure(!['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'FAILED_PRECONDITION', 'NOT_FOUND', 'ALREADY_EXISTS'].includes(String(object(raw.error ?? {}).status)))
      const result = object(raw.result ?? raw.data)
      if (result.ok !== true) throw new ChannelAccessFailure(true)
      if (phase === 'join' && identifier(result.discussionChatId) !== expectedDiscussionId) throw new ChannelAccessFailure(true)
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  } catch (error) { throw error instanceof ChannelAccessFailure ? error : new ChannelAccessFailure(true) }
}
