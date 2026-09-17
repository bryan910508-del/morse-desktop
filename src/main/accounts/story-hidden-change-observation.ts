import type { StoryHiddenChangeObservation, StoryHiddenChangeRequest } from '../../shared/story-hidden-change'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { positionMilliseconds } from '../../shared/model'
import { tr } from '../../shared/i18n'
export function observeStoryHiddenChange(request: StoryHiddenChangeRequest, doc: FirestoreDocument | null): StoryHiddenChangeObservation {
  let outcome: StoryHiddenChangeObservation['outcome'] = 'absent'
  if (doc) {
    if (doc.name !== `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`) throw new Error('Hidden audience story scope mismatch')
    const current = ownStoryFromDocument(doc, request.ownerId, request.privacy), hidden = JSON.stringify(storyHiddenFrom(doc).hiddenFrom)
    outcome = positionMilliseconds(current.expires) <= Date.now() ? 'expired' : hidden === JSON.stringify(request.desired) ? 'matching' : current.version === request.version && hidden === JSON.stringify(request.original) ? 'original' : 'different'
  }
  const message = { matching: tr('조회한 숨김 목록이 검토한 변경 목록과 같습니다.'), original: tr('조회한 스토리 버전과 숨김 목록이 변경 전 원문과 같습니다.'), different: tr('현재 스토리 버전 또는 숨김 목록이 검토한 내용과 다릅니다.'), expired: tr('조회한 스토리가 이 기기 시각 기준으로 만료되었습니다.'), absent: tr('이 공개 범위에 현재 스토리 문서가 없습니다.'), unavailable: tr('현재 숨김 설정을 확인하지 못했습니다.') }[outcome]
  return { outcome, observedAt: Date.now(), message: tr('{0} 현재 조회는 과거 변경 응답을 대신하지 않으며 자동 재전송하거나 기록을 완료하지 않습니다.', [message]) }
}
