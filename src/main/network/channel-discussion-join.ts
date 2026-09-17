import type { DiscussionJoinRequest } from '../../shared/channel-discussion-join'
import { FirestoreReader, type ReadCredentials } from './firestore-rpc'
import { documents, documentVersion, stringField } from './firestore-values'
import { channelDiscussionReference } from '../accounts/channel-discussion-reference'
import { syncChannelDiscussion } from './channel-discussion-sync'
import { ChannelAccessFailure } from './channel-access-write'
export async function joinDiscussion(auth: ReadCredentials, uid: string, request: DiscussionJoinRequest, signal: AbortSignal, validate: () => void): Promise<void> {
  const bounded = AbortSignal.any([auth.signal, signal, AbortSignal.timeout(65000)]), reader = new FirestoreReader(auth)
  try {
    // This preflight observes current roles; only the existing callable checks bans/account state atomically.
    try {
      bounded.throwIfAborted(); validate()
      const path = `${documents}/channels/${request.channelId}`
      const [root, sub, admin] = await Promise.all([path, `${path}/subscribers/${uid}`, `${path}/admins/${uid}`].map(name => reader.getDocument(name, bounded)))
      bounded.throwIfAborted(); validate()
      if (!root || root.name !== path || documentVersion(root) !== request.version || stringField(root.fields, 'name', 512).trim() !== request.title || channelDiscussionReference(root).chatId !== request.chatId ||
        (sub && sub.name !== `${path}/subscribers/${uid}`) || (admin && admin.name !== `${path}/admins/${uid}`) ||
        (stringField(root.fields, 'ownerId', 160) !== uid && !sub && !admin)) throw new Error('Discussion participation scope changed')
    } catch { throw new ChannelAccessFailure(false) }
    await syncChannelDiscussion(auth, request.channelId, 'join', bounded, validate, request.chatId)
  } finally { reader.close() }
}
