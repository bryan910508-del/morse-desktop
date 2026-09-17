import { object } from '../../shared/validation'
import type { ReadCredentials, ReadAuthorization } from './firestore-rpc'
import { tr } from '../../shared/i18n'

export class ChannelMembershipFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('채널 가입 상태를 확인해야 합니다.') : tr('채널 가입 요청이 거절되었습니다.')) } }

// joinMorseChannel / leaveMorseChannel (morse-release-authority.js channelMembership):
// both run as one transaction keyed by the caller and the channel, so a repeated
// call observes the same membership instead of adding a second one.
export async function callChannelMembership(auth: ReadCredentials, name: 'joinMorseChannel' | 'leaveMorseChannel', channelId: string, signal: AbortSignal, validate: () => void): Promise<'joined' | 'pending' | 'left'> {
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(65000)])
  let authorization: ReadAuthorization
  try { bounded.throwIfAborted(); validate(); authorization = await auth.authorize(bounded, false); bounded.throwIfAborted(); validate() }
  catch { throw new ChannelMembershipFailure(false) }
  try {
    const response = await fetch(`https://asia-northeast3-talky-a38c3.cloudfunctions.net/${name}`, {
      method: 'POST', signal: bounded, redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authorization.idToken}`, 'X-Firebase-AppCheck': authorization.appCheckToken },
      body: JSON.stringify({ data: { channelId } })
    })
    if (!response.body) throw new ChannelMembershipFailure(true)
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read(); bounded.throwIfAborted()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 64 * 1024) throw new ChannelMembershipFailure(true)
        chunks.push(chunk.value)
      }
      const raw = object(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!response.ok || raw.error !== undefined) {
        const status = String(object(raw.error ?? {}).status)
        throw new ChannelMembershipFailure(!['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'NOT_FOUND', 'FAILED_PRECONDITION'].includes(status))
      }
      const result = object(raw.result ?? raw.data)
      if (result.ok !== true || result.channelId !== channelId) throw new ChannelMembershipFailure(true)
      if (name === 'leaveMorseChannel') return 'left'
      if (result.status === 'joined') return 'joined'
      if (result.status === 'pending') return 'pending'
      throw new ChannelMembershipFailure(true)
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); chunks.forEach(chunk => chunk.fill(0)) }
  } catch (error) { throw error instanceof ChannelMembershipFailure ? error : new ChannelMembershipFailure(true) }
}
