import type { StoryPrivacyMoveObservation, StoryPrivacyMoveRequest } from '../../shared/story-privacy-move'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { tr } from '../../shared/i18n'
export function observeStoryPrivacyMove(request: StoryPrivacyMoveRequest, source: FirestoreDocument | null, destination: FirestoreDocument | null): StoryPrivacyMoveObservation {
  for (const [doc, privacy] of [[source, request.privacy], [destination, request.desired]] as const) {
    if (!doc) continue
    if (doc.name !== `${documents}/users/${request.ownerId}/${ownStoryCollections[privacy]}/${request.storyId}`) throw new Error('Story scope mismatch')
    ownStoryFromDocument(doc, request.ownerId, privacy)
  }
  const outcome = source ? destination ? 'both' : 'source-only' : destination ? 'destination-only' : 'neither'
  const presence = { both: tr('두 공개 범위에서 문서를 확인했습니다.'), 'source-only': tr('원래 공개 범위에서만 문서를 확인했습니다.'), 'destination-only': tr('변경 대상 공개 범위에서만 문서를 확인했습니다.'), neither: tr('두 공개 범위 모두 문서가 없습니다.') }[outcome]
  return { outcome, observedAt: Date.now(), message: tr('{0} 두 문서를 순서대로 읽은 결과이며 같은 시점의 원자적 조회가 아닙니다. 과거 이동 응답·파일 정리 결과를 판단하거나 자동 재전송하지 않습니다.', [presence]) }
}
