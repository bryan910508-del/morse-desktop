import type { StoryReactionChangeRequest, StoryReactionChangeObservation } from '../../shared/story-reaction-change'
import { positionMilliseconds } from '../../shared/model'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { currentViewerReaction } from '../network/contact-story-reaction'
import { tr } from '../../shared/i18n'
export function observeStoryReaction(request: StoryReactionChangeRequest, doc: FirestoreDocument | null): StoryReactionChangeObservation {
  let outcome: StoryReactionChangeObservation['outcome'] = 'absent'
  if (doc) {
    if (doc.name !== `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`) throw new Error('Reaction observation scope mismatch')
    const story = ownStoryFromDocument(doc, request.ownerId, request.privacy)
    if (storyHiddenFrom(doc).hiddenFrom.includes(request.viewerId)) throw new Error('Story hidden from viewer')
    const value = currentViewerReaction(doc, request.viewerId).value
    outcome = positionMilliseconds(story.expires) <= Date.now() ? 'expired' : value === request.desired ? 'matching' : story.version === request.version && value === request.original ? 'original' : 'different'
  }
  const message = { matching: tr('조회한 본인 반응이 검토한 변경 값과 같습니다.'), original: tr('조회한 스토리 버전과 본인 반응이 변경 전과 같습니다.'), different: tr('현재 스토리 버전 또는 본인 반응이 검토한 내용과 다릅니다.'), expired: tr('현재 스토리가 이 기기 시각 기준으로 만료되었습니다.'), absent: tr('기록에 보관된 공개 범위에서 현재 스토리 문서를 확인하지 못했습니다.'), unavailable: tr('현재 스토리와 본인 반응을 확인하지 못했습니다.') }[outcome]
  return { outcome, observedAt: Date.now(), message: tr('{0} 현재 조회는 과거 변경 응답을 대신하지 않으며 기록 상태를 바꾸거나 자동 재전송하지 않습니다.', [message]) }
}
