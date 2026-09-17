import type { ChannelDiscussionReference } from '../../shared/channel-discussion-navigation'
import { identifier } from '../../shared/validation'
import type { FirestoreDocument } from '../network/firestore-values'
export function channelDiscussionReference(doc: FirestoreDocument): ChannelDiscussionReference {
  const value = doc.fields.discussionChatId
  if (value === undefined || value.stringValue === '') return { status: 'none', chatId: null }
  try { return { status: 'known', chatId: identifier(value.stringValue) } }
  catch { return { status: 'unknown', chatId: null } }
}
