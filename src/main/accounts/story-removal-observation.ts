import type { StoryRemovalObservation, StoryRemovalRequest } from '../../shared/story-removal'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { positionMilliseconds } from '../../shared/model'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { tr } from '../../shared/i18n'
export function observeStoryRemoval(request: StoryRemovalRequest, doc: FirestoreDocument | null): StoryRemovalObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, message: tr('조회 시점에 이 공개 범위의 스토리 문서가 없습니다. 과거 삭제 응답이나 파일 정리 완료의 증거는 아닙니다. 기기 초안과 기록을 유지합니다.') }
  if (doc.name !== `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`) throw new Error('Current story path mismatch')
  const current = ownStoryFromDocument(doc, request.ownerId, request.privacy)
  if (positionMilliseconds(current.expires) <= observedAt) return { outcome: 'expired', observedAt, message: tr('조회한 문서는 이 기기 시각상 만료되었습니다. 문서나 파일 삭제 완료를 뜻하지 않습니다.') }
  if (current.version === request.version && current.caption === request.caption && current.mediaType === request.mediaType && positionMilliseconds(current.expires) === request.expiresAt) return { outcome: 'original', observedAt, message: tr('조회 시점에 삭제 대상으로 검토한 원문과 버전이 그대로입니다. 진행 중인 요청의 실패나 취소를 판단하지 않습니다.') }
  return { outcome: 'different', observedAt, message: tr('현재 스토리 문서가 삭제 검토 당시와 다릅니다. 자동 삭제나 재전송을 하지 않으며 기기 초안과 기록을 유지합니다.') }
}
