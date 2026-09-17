import { backgroundPhotoId } from './chat-background'
import { commentDraftTarget, commentDraftText, commentReplyTarget, type CommentReplyTarget, type CommentDraftTarget } from './channel-comment-drafts'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface CommentCreationPrepare extends CommentDraftTarget { surface?: 'public-preview'; id: string; draftRevision: string; text: string; parent?: CommentReplyTarget }
export interface CommentCreationRequest extends CommentCreationPrepare { parentAuthorName?: string; postRevision: string; count: number; authorId: string; authorName: string; authorPhotoURL: string | null; profileVersion: string }
export type CommentCreationState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingCommentCreation extends CommentCreationRequest { state: CommentCreationState }
export interface CommentCreationObservation { outcome: 'matching' | 'different' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface CommentCreationSnapshot { observation: CommentCreationObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingCommentCreation | null; message: string }
export interface CommentCreationAction { id: string; state: CommentCreationState; action: 'send' | 'check' | 'dismiss' }
const prepareKeys = ['surface', 'channelId', 'postId', 'id', 'draftRevision', 'text', 'parent']
export function commentCreationPrepare(raw: unknown): CommentCreationPrepare {
  const v = object(raw), target = commentDraftTarget({ channelId: v.channelId, postId: v.postId }), text = commentDraftText(v.text)
  if (Object.keys(v).some(k => !prepareKeys.includes(k)) || !text.trim() || (v.surface !== undefined && v.surface !== 'public-preview')) throw new Error(tr('저장한 댓글 초안을 다시 확인해 주세요.'))
  return { ...target, ...(v.surface === 'public-preview' ? { surface: 'public-preview' as const } : {}), id: backgroundPhotoId(v.id), draftRevision: backgroundPhotoId(v.draftRevision), text, ...(v.parent === undefined ? {} : { parent: commentReplyTarget(v.parent) }) }
}
export function commentCreationRequest(raw: unknown): CommentCreationRequest {
  const v = object(raw), prepare = commentCreationPrepare(Object.fromEntries(prepareKeys.map(k => [k, v[k]])))
  if (Object.keys(v).some(k => ![...prepareKeys, 'postRevision', 'count', 'authorId', 'authorName', 'authorPhotoURL', 'profileVersion', 'parentAuthorName'].includes(k)) ||
    typeof v.postRevision !== 'string' || !/^[a-f0-9]{64}$/.test(v.postRevision) || typeof v.profileVersion !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.profileVersion) ||
    typeof v.count !== 'number' || !Number.isSafeInteger(v.count) || v.count < 0 || v.count >= Number.MAX_SAFE_INTEGER ||
    typeof v.authorName !== 'string' || !v.authorName.trim() || v.authorName.length > 512 ||
    (prepare.parent ? typeof v.parentAuthorName !== 'string' || !v.parentAuthorName.trim() || v.parentAuthorName.length > 512 : v.parentAuthorName !== undefined) ||
    (v.authorPhotoURL !== null && (typeof v.authorPhotoURL !== 'string' || !v.authorPhotoURL || v.authorPhotoURL.length > 10000))) throw new Error(tr('현재 게시물과 작성자 정보를 다시 확인해 주세요.'))
  return { ...prepare, postRevision: v.postRevision, count: v.count, authorId: identifier(v.authorId), authorName: v.authorName, authorPhotoURL: v.authorPhotoURL as string | null, profileVersion: v.profileVersion, ...(prepare.parent ? { parentAuthorName: v.parentAuthorName as string } : {}) }
}
export function commentCreationAction(raw: unknown): CommentCreationAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(String(v.state)) || !['send', 'check', 'dismiss'].includes(String(v.action))) throw new Error(tr('댓글 등록 기록을 다시 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as CommentCreationState, action: v.action as CommentCreationAction['action'] }
}
