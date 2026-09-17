import type { PendingStoryPublication, StoryPublicationObservation } from '../../shared/story-publication'
import { ownStoryFromDocument, ownStoryCollections } from '../network/own-story-document'
import { storyHiddenFrom } from '../network/story-hidden-audience'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { storyPhotoPath } from '../media/story-photo-upload-record'
import { storageBucket } from '../media/media-document'
import { tr } from '../../shared/i18n'
export function observeStoryPublication(pending: PendingStoryPublication, doc: FirestoreDocument | null): StoryPublicationObservation {
  const observedAt = Date.now()
  if (!pending.time || !['submitted', 'confirmed', 'rejected'].includes(pending.state)) throw new Error(tr('현재 게시 요청 기록을 확인해 주세요.'))
  if (!doc) return { outcome: 'absent', observedAt, expiresAt: null, message: tr('조회 시점에 원래 게시 범위의 같은 ID 문서가 없습니다. 다른 범위로 이동했는지나 과거 게시 성공·실패·삭제 원인을 추정하지 않습니다. 자동 재게시하지 않습니다.') }
  if (doc.name !== `${documents}/users/${pending.ownerId}/${ownStoryCollections[pending.privacy]}/${pending.id}`) throw new Error('Story observation path changed')
  const current = ownStoryFromDocument(doc, pending.ownerId, pending.privacy), f = doc.fields, hidden = storyHiddenFrom(doc)
  const expiresAt = current.expires.seconds * 1000 + current.expires.nanoseconds / 1000000
  const exactTime = (actual: { seconds: number; nanoseconds: number }, value: number): boolean => actual.seconds === Math.floor(value / 1000) && actual.nanoseconds === value % 1000 * 1000000
  const matching = f.ownerType?.stringValue === 'user' && f.ownerId?.stringValue === pending.ownerId && f.privacy?.stringValue === pending.privacy && f.caption?.stringValue === pending.caption && current.mediaType === 'image' && f.mediaURL?.stringValue === `gs://${storageBucket}/${storyPhotoPath(pending.ownerId, pending.id, 'full')}` && f.thumbnailURL?.stringValue === `gs://${storageBucket}/${storyPhotoPath(pending.ownerId, pending.id, 'thumbnail')}` && hidden.field === 'stored' && hidden.hiddenFrom.length === pending.hiddenFrom.length && hidden.hiddenFrom.every(uid => pending.hiddenFrom.includes(uid)) && exactTime(current.created, pending.time.createdAt) && exactTime(current.expires, pending.time.expiresAt) && (pending.audio?f.audioURL?.stringValue===`gs://${storageBucket}/${storyPhotoPath(pending.ownerId,pending.id,'audio')}`:f.audioURL===undefined) && ['durationSeconds', 'originalOwnerId', 'originalStoryId'].every(key => f[key] === undefined)
  if (expiresAt <= observedAt) return { outcome: 'expired', observedAt, expiresAt, message: tr('같은 ID의 현재 문서는 만료 시각이 지났습니다. 이전 게시 응답을 확인한 것으로 취급하지 않으며 자동 재게시하거나 서버 문서를 삭제하지 않습니다.') }
  return { outcome: matching ? 'matching' : 'different', observedAt, expiresAt, message: matching ? tr('현재 문서의 게시자·사진/선택 오디오 참조·설명·공개 범위·숨김 대상·게시/만료 시각이 준비 기록과 일치합니다. 사진/오디오 파일의 현재 내용이나 과거 게시 성공 응답을 증명하지 않습니다. 기기 초안을 자동으로 비우지 않습니다.') : tr('현재 문서가 있지만 게시 준비 내용과의 일치를 확인할 수 없습니다. 변경 원인을 추정하거나 현재 문서를 덮어쓰지 않습니다. 기기 기록을 유지합니다.') }
}
