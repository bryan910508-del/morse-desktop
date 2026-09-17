import { channelCommentsRequest, type ChannelCommentsRequest } from './channel-comments'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelCommentRemoval extends ChannelCommentsRequest { id: string; commentId: string; commentRevision: string; text: string; count: number }
export interface ChannelCommentRemovalResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelCommentRemoval(raw: unknown): ChannelCommentRemoval {
  const value = object(raw)
  if (Object.keys(value).some(key => !['id', 'selectionId', 'requestId', 'channelId', 'postId', 'revision', 'commentId', 'commentRevision', 'text', 'count'].includes(key)) ||
    typeof value.commentRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.commentRevision) || typeof value.text !== 'string' || value.text.length > 1000 || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 1 || value.count > 100) throw new Error(tr('최신 목록에서 내 댓글을 다시 선택해 주세요.'))
  return { ...channelCommentsRequest({ selectionId: value.selectionId, requestId: value.requestId, channelId: value.channelId, postId: value.postId, revision: value.revision }), id: identifier(value.id), commentId: identifier(value.commentId), commentRevision: value.commentRevision, text: value.text, count: value.count }
}
