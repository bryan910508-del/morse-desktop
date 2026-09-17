import type { ChannelCreationObservation, ChannelCreationRequest } from '../../shared/channel-creation'
import { documents, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { channelDiscussionReference } from './channel-discussion-reference'
import { tr } from '../../shared/i18n'
export function observeChannelCreation(request: ChannelCreationRequest, doc: FirestoreDocument | null): ChannelCreationObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, discussion: 'unobserved', message: tr('조회 시점에 이 채널 ID의 문서가 없습니다. 과거 생성 실패·취소를 증명하지 않으며 요청을 다시 보내지 않습니다.') }
  const f = doc.fields
  let dated = false
  try { if (f.createdAt?.timestampValue && doc.updateTime) { timestamp(f.createdAt.timestampValue, ''); timestamp(doc.updateTime, ''); dated = true } } catch { /* Malformed current metadata is not a creation acknowledgement. */ }
  const identity = dated && doc.name === `${documents}/channels/${request.id}` && f.id?.stringValue === request.id && f.ownerId?.stringValue === request.ownerId
  const matching = identity && Object.entries({ name: request.name, description: request.description, type: 'private', joinPolicy: 'open', chatMode: 'broadcast' }).every(([key, value]) => f[key]?.stringValue === value) && f.isPublic?.booleanValue === false && f.discussionHistoryVisible?.booleanValue === true
  // Photos, tags, counters, administrators and owner caches may legitimately change after creation.
  return { outcome: matching ? 'matching' : 'different', observedAt, discussion: identity ? channelDiscussionReference(doc).status : 'unobserved',
    message: matching ? tr('조회 시점에 같은 ID·소유자·이름·소개·기본 접근 설정의 채널 문서가 있습니다. 과거 생성 응답이나 토론방 준비 완료를 증명하지 않습니다. 제출 상태를 유지합니다.') : tr('현재 문서가 있지만 검토한 ID·소유자·이름·소개·기본 접근 설정·시각 정보의 일치를 확인할 수 없습니다. 변경된 값을 덮어쓰거나 생성 요청을 다시 보내지 않습니다.') }
}
