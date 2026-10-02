import type { ReadCredentials } from './firestore-rpc'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
import { tr } from '../../shared/i18n'

export class ChannelMembershipFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('채널 가입 상태를 확인해야 합니다.') : tr('채널 가입 요청이 거절되었습니다.')) } }

// joinMorseChannel / leaveMorseChannel (morse-release-authority.js channelMembership):
// both run as one transaction keyed by the caller and the channel, so a repeated
// call observes the same membership instead of adding a second one.
export async function callChannelMembership(auth: ReadCredentials, name: 'joinMorseChannel' | 'leaveMorseChannel', channelId: string, signal: AbortSignal, validate: () => void): Promise<'joined' | 'pending' | 'left'> {
  let result: Record<string, unknown>
  // Only an outcome the request may have caused is uncertain: one that never left, or that the server refused, is not.
  try { result = await callMorseFunction(auth, name, { channelId }, signal, { validate, limit: 64 * 1024 }) }
  catch (error) { throw new ChannelMembershipFailure(error instanceof MorseCallableFailure && error.uncertain) }
  if (result.ok !== true || result.channelId !== channelId) throw new ChannelMembershipFailure(true)
  if (name === 'leaveMorseChannel') return 'left'
  if (result.status === 'joined') return 'joined'
  if (result.status === 'pending') return 'pending'
  throw new ChannelMembershipFailure(true)
}
