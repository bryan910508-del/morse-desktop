import type { CommentCreationObservation, CommentCreationRequest } from '../../shared/channel-comment-creation'
import { documents, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
export function observeCommentCreation(request: CommentCreationRequest, doc: FirestoreDocument | null): CommentCreationObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, message: tr('조회 시점에 이 댓글 ID의 문서가 없습니다. 과거 등록 실패나 취소의 증거가 아니며 다시 전송하지 않습니다.') }
  const f = doc.fields
  const matching = doc.name === `${documents}/channels/${request.channelId}/posts/${request.postId}/comments/${request.id}` &&
    Object.entries({ id: request.id, channelId: request.channelId, postId: request.postId, authorId: request.authorId, authorName: request.authorName, text: request.text }).every(([key, text]) => f[key]?.stringValue === text) &&
    (request.authorPhotoURL === null ? f.authorPhotoURL === undefined : f.authorPhotoURL?.stringValue === request.authorPhotoURL) && (request.parent ? f.parentCommentId?.stringValue === request.parent.id && f.parentAuthorName?.stringValue === request.parentAuthorName : f.parentCommentId === undefined && f.parentAuthorName === undefined)
  let dated = false
  try { if (f.createdAt?.timestampValue && doc.updateTime) { timestamp(f.createdAt.timestampValue, ''); timestamp(doc.updateTime, ''); dated = true } } catch { /* A malformed date is not evidence of the prepared write. */ }
  return matching && dated ? { outcome: 'matching', observedAt, message: tr('조회 시점에 같은 ID로 원문·작성자·답글 대상 구분이 일치하는 문서가 있습니다. 이는 과거 배치 응답이나 당시 집계 증가를 증명하지 않습니다. 제출 기록과 초안은 그대로 유지합니다.') } :
    { outcome: 'different', observedAt, message: tr('조회 시점에 같은 ID의 문서가 있지만 검토한 내용·작성자·댓글 구분·시각 정보와 일치한다고 확인할 수 없습니다. 원격 내용을 덮어쓰거나 추가 댓글을 보내지 않습니다.') }
}
