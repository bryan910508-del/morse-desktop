import type { StoryCaptionSaveObservation, StoryCaptionSaveRequest } from '../../shared/story-caption-save'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { positionMilliseconds } from '../../shared/model'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { tr } from '../../shared/i18n'
export function observeStoryCaptionSave(request: StoryCaptionSaveRequest, doc: FirestoreDocument | null): StoryCaptionSaveObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, message: tr('조회 시점에 해당 공개 범위의 스토리 문서가 없습니다. 과거 수정 결과나 삭제·공개 범위 이동 원인은 판단하지 않습니다.') }
  if (doc.name !== `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`) throw new Error('Current story path mismatch')
  const current = ownStoryFromDocument(doc, request.ownerId, request.privacy)
  if (positionMilliseconds(current.expires) <= observedAt) return { outcome: 'expired', observedAt, message: tr('조회한 스토리가 이 기기 시각상 만료되었습니다. 과거 저장 결과와 기기 초안은 변경하지 않습니다.') }
  if (current.caption === request.draft.caption) return { outcome: 'matching', observedAt, message: tr('조회 시점의 설명이 요청 내용과 같습니다. 과거 수정 응답의 증거는 아니며 기록과 기기 초안을 유지합니다.') }
  if (current.version === request.draft.baseVersion && current.caption === request.draft.baseCaption) return { outcome: 'original', observedAt, message: tr('조회 시점에 편집 시작 설명과 문서 버전이 그대로입니다. 진행 중인 요청의 실패나 취소로 판단하지 않습니다.') }
  return { outcome: 'different', observedAt, message: tr('현재 설명 또는 문서 버전이 편집 시작 때와 다릅니다. 원인을 추정하거나 자동으로 덮어쓰지 않습니다.') }
}
