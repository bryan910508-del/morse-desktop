import type { PendingStoryReplyDraft } from '../../shared/story-reply-draft'
import { storyReplyDraftRequest } from '../../shared/story-reply-draft'
import type { TextSendWire } from '../../shared/model'
import { identifier, outgoingText } from '../../shared/validation'
export function storyReplyWire(pending: PendingStoryReplyDraft, chatId: string, peerUid?: string): TextSendWire {
  const { state: _state, text, revision: _revision, ...source } = pending
  const record = storyReplyDraftRequest(source)
  if (peerUid !== undefined && peerUid !== record.ownerId) throw new Error('Story reply destination changed')
  const wire: TextSendWire = { id: record.id, chatId: identifier(chatId), senderId: record.viewerId, type: 'text', text: outgoingText(text), isSilent: false, isEncrypted: false, protocolVersion: 3,
    replyStoryOwnerName: record.ownerName.trim(), replyStoryOwnerType: 'user', replyStoryId: record.storyId, replyStoryOwnerId: record.ownerId, replyStoryExpiresAt: Math.trunc(record.expiresAt) }
  if (peerUid !== undefined) { wire.peerUid = identifier(peerUid); wire.chatType = 'direct' }
  return wire
}
