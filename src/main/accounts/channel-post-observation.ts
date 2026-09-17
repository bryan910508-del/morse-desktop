import type { PostCreationObservation, PostCreationRequest } from '../../shared/channel-post-creation'
import { documents, timestamp, type FirestoreDocument, type WireObject } from '../network/firestore-values'
import { storageBucket } from '../media/media-document'
import { channelPostPhotoPath } from '../../shared/channel-post-photo'
import { tr } from '../../shared/i18n'
function listValues(field: WireObject | undefined): string[] | null {
  const values = (field?.arrayValue as { values?: { stringValue?: unknown }[] } | undefined)?.values
  return Array.isArray(values) ? values.map(value => typeof value?.stringValue === 'string' ? value.stringValue : '') : null
}
function mediaMatches(f: Record<string, WireObject>, request: PostCreationRequest): boolean {
  if (!request.photos.length) return ['mediaKeys', 'mediaTypes', 'thumbnailKeys'].every(key => f[key] === undefined)
  const keys = request.photos.map(photo => `gs://${storageBucket}/${channelPostPhotoPath(request.channelId, photo.id)}`)
  return f.thumbnailKeys === undefined && JSON.stringify(listValues(f.mediaKeys)) === JSON.stringify(keys) && JSON.stringify(listValues(f.mediaTypes)) === JSON.stringify(keys.map(() => 'image'))
}
export function observePostCreation(request: PostCreationRequest, doc: FirestoreDocument | null): PostCreationObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, message: tr('조회 시점에 이 게시물 ID의 문서가 없습니다. 과거 게시 실패나 취소의 증거가 아니며 다시 전송하지 않습니다.') }
  const f = doc.fields
  const matching = doc.name === `${documents}/channels/${request.channelId}/posts/${request.id}` &&
    Object.entries({ id: request.id, channelId: request.channelId, authorId: request.authorId, text: request.text, visibility: request.visibility, aspectRatio: '4:5' }).every(([key, value]) => f[key]?.stringValue === value) &&
    mediaMatches(f, request)
  let dated = false
  try { if (f.createdAt?.timestampValue && doc.updateTime) { timestamp(f.createdAt.timestampValue, ''); timestamp(doc.updateTime, ''); dated = true } } catch { /* Current malformed timestamps do not confirm the prepared post. */ }
  // Engagement and pin flags can legitimately change after posting and are not historical ACK evidence.
  return matching && dated ? { outcome: 'matching', observedAt, message: tr('조회 시점에 같은 ID로 원문·작성자·공개 범위·텍스트 글 구분이 일치하는 문서가 있습니다. 과거 생성 응답이나 미러·알림 완료를 증명하지 않습니다. 제출 기록과 초안은 유지합니다.') } :
    { outcome: 'different', observedAt, message: tr('조회 시점에 같은 ID의 문서가 있지만 검토한 원문·작성자·공개 범위·텍스트 글 구분·시각 정보와 일치한다고 확인할 수 없습니다. 내용을 덮어쓰거나 새 글을 보내지 않습니다.') }
}
