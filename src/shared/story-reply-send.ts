import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface StoryReplySendRequest { id: string; revision: string }
export interface StoryReplySendReceipt { id: string; chatId: string }
export interface StoryReplyWireFields {
  replyStoryOwnerName?: string
  replyStoryOwnerType?: 'user'
  replyStoryId?: string
  replyStoryOwnerId?: string
  replyStoryExpiresAt?: number
}
export function storyReplySendRequest(raw: unknown): StoryReplySendRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'revision'].includes(k))) throw new Error(tr('보낼 답장 저장본을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), revision: backgroundPhotoId(v.revision) }
}
