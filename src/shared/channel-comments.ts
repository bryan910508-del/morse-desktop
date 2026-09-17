import type { MessagePosition } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelCommentsRequest { selectionId: string; requestId: string; channelId: string; postId: string; revision: string }
export interface ChannelCommentItem { revision: string; id: string; authorId: string; authorName: string; own: boolean; text: string; position: MessagePosition | null; parent: 'none' | 'present' | 'unavailable' | 'invalid'; parentId: string | null; parentAuthorName: string; photo?: import('./group-photo').GroupPhotoImage | null }
export interface ChannelCommentsSnapshot extends ChannelCommentsRequest { status: 'loading' | 'ready' | 'error' | 'blocked' | 'limit'; items: ChannelCommentItem[]; message: string }
export function channelCommentsRequest(raw: unknown): ChannelCommentsRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['selectionId', 'requestId', 'channelId', 'postId', 'revision'].includes(key)) || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision)) throw new Error(tr('최신 게시물에서 댓글을 다시 열어 주세요.'))
  return { selectionId: identifier(value.selectionId), requestId: identifier(value.requestId), channelId: identifier(value.channelId), postId: identifier(value.postId), revision: value.revision }
}
