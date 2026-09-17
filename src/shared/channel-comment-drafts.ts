import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface CommentDraftTarget { channelId: string; postId: string }
export interface CommentReplyTarget { id: string; revision: string }
export interface CommentDraftOpen extends CommentDraftTarget { reply?: CommentReplyTarget }
export interface CommentDraftParent extends CommentDraftTarget { surface?: 'public-preview'; expected: string | null; revision: string; parent: CommentReplyTarget | null }
export function commentReplyTarget(raw: unknown): CommentReplyTarget {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'revision'].includes(k)) || typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision)) throw new Error(tr('현재 원댓글을 다시 선택해 주세요.'))
  return { id: identifier(v.id), revision: v.revision }
}
export function sameCommentReply(a: CommentReplyTarget | null | undefined, b: CommentReplyTarget | null | undefined): boolean { return a?.id === b?.id && a?.revision === b?.revision }
export function commentDraftParent(raw: unknown): CommentDraftParent {
  const v = object(raw), target = commentDraftTarget({ channelId: v.channelId, postId: v.postId })
  if (Object.keys(v).some(k => !['surface', 'channelId', 'postId', 'expected', 'revision', 'parent'].includes(k)) || (v.surface !== undefined && v.surface !== 'public-preview') || v.expected === undefined || v.parent === undefined) throw new Error(tr('초안과 답글 대상을 다시 확인해 주세요.'))
  const revision = backgroundPhotoId(v.revision), expected = v.expected === null ? null : backgroundPhotoId(v.expected)
  if (revision === expected) throw new Error(tr('새 초안 버전이 필요합니다.'))
  return { ...target, ...(v.surface === 'public-preview' ? { surface: 'public-preview' as const } : {}), expected, revision, parent: v.parent === null ? null : commentReplyTarget(v.parent) }
}
export interface CommentDraftRecord extends CommentDraftTarget { parent: CommentReplyTarget | null; text: string; revision: string | null }
export interface CommentDraftWrite extends CommentDraftTarget { text: string; expected: string | null; revision: string }
export function commentDraftTarget(raw: unknown): CommentDraftTarget {
  const value = object(raw)
  if (Object.keys(value).some(key => !['channelId', 'postId'].includes(key))) throw new Error(tr('댓글 초안 대상을 다시 선택해 주세요.'))
  return { channelId: identifier(value.channelId), postId: identifier(value.postId) }
}
export function commentDraftText(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 1000) throw new Error(tr('댓글 초안은 1,000자 이내로 입력해 주세요.'))
  return raw
}
export function commentDraftWrite(raw: unknown): CommentDraftWrite {
  const value = object(raw), target = commentDraftTarget({ channelId: value.channelId, postId: value.postId })
  if (Object.keys(value).some(key => !['channelId', 'postId', 'text', 'expected', 'revision'].includes(key)) || value.expected === undefined) throw new Error(tr('현재 댓글 초안을 다시 확인해 주세요.'))
  const revision = backgroundPhotoId(value.revision), expected = value.expected === null ? null : backgroundPhotoId(value.expected)
  if (revision === expected) throw new Error(tr('새 초안 저장 식별자가 필요합니다.'))
  return { ...target, text: commentDraftText(value.text), expected, revision }
}
