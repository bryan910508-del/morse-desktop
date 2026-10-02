import type { ReadCredentials } from './firestore-rpc'
import { identifier } from '../../shared/validation'
import { ChannelAccessFailure } from './channel-access-write'
import { callMorseFunction, MorseCallableFailure } from './morse-callable'
export async function syncChannelDiscussion(auth: ReadCredentials, channelId: string, phase: 'join' | 'sync', signal: AbortSignal, validate: () => void, expectedDiscussionId: string): Promise<void> {
  identifier(channelId); identifier(expectedDiscussionId)
  let result: Record<string, unknown>
  // Only an outcome the request may have caused is uncertain: one that never left, or that the server refused, is not.
  try { result = await callMorseFunction(auth, phase === 'join' ? 'joinChannelDiscussion' : 'syncChannelDiscussionMembers', { channelId }, signal, { validate, limit: 65536 }) }
  catch (error) { throw new ChannelAccessFailure(error instanceof MorseCallableFailure && error.uncertain) }
  try {
    if (result.ok !== true) throw new Error('Invalid answer')
    if (phase === 'join' && identifier(result.discussionChatId) !== expectedDiscussionId) throw new Error('Invalid answer')
  } catch { throw new ChannelAccessFailure(true) }
}
