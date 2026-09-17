import type { StoryViewReceiptRequest, StoryViewReceiptObservation } from '../../shared/story-view-receipt'
import { positionMilliseconds } from '../../shared/model'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { currentViewerRecord } from '../network/contact-story-view-record'
import { locale, tr } from '../../shared/i18n'
export function observeStoryViewReceipt(request: StoryViewReceiptRequest, doc: FirestoreDocument | null): StoryViewReceiptObservation {
  let outcome: StoryViewReceiptObservation['outcome'] = 'absent', detail = ''
  if (doc) {
    if (doc.name !== `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`) throw new Error('View receipt observation scope mismatch')
    const story = ownStoryFromDocument(doc, request.ownerId, request.privacy)
    if (storyHiddenFrom(doc).hiddenFrom.includes(request.viewerId)) throw new Error('Story hidden from viewer')
    const value = currentViewerRecord(doc, request.viewerId)
    outcome = positionMilliseconds(story.expires) <= Date.now() ? 'expired' : value.listed && value.viewedAt !== null ? 'recorded' : story.version === request.version && !value.listed && value.viewerFieldPresent === request.viewerFieldPresent && value.timeField === request.originalTimeField && value.viewedAt === request.originalViewedAt ? 'original' : 'different'
    if (outcome === 'recorded') detail = tr(' 본인 열람 시각: {0}.', [new Date(value.viewedAt!).toLocaleString(locale())])
  }
  const message = { recorded: tr('현재 열람 목록에 본인과 본인 열람 시각이 저장되어 있습니다.'), original: tr('현재 문서 버전과 본인 열람 기록이 준비 전과 같습니다.'), different: tr('현재 문서 버전 또는 본인 열람 목록·시각이 준비 내용과 다릅니다.'), expired: tr('현재 스토리가 이 기기 시각 기준으로 만료되었습니다.'), absent: tr('기록에 보관된 공개 범위에서 현재 스토리 문서를 확인하지 못했습니다.'), unavailable: tr('현재 스토리와 열람 기록을 확인하지 못했습니다.') }[outcome]
  return { outcome, observedAt: Date.now(), message: tr('{0}{1} 현재 관측은 과거 전송 응답이나 이 기기에서 열람했다는 증거를 대신하지 않습니다. 기록 상태를 바꾸거나 자동 재전송하지 않습니다.', [message, detail]) }
}
