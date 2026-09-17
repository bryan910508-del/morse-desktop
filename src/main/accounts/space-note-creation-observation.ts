import type { NoteCreationObservation, NoteCreationRequest } from '../../shared/space-note-creation'
import { documents, timestamp, type FirestoreDocument } from '../network/firestore-values'
import { tr } from '../../shared/i18n'
export function observeNoteCreation(request: NoteCreationRequest, doc: FirestoreDocument | null): NoteCreationObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, message: tr('조회 시점에 이 노트 ID의 문서가 없습니다. 과거 생성 실패·취소의 증거가 아니며 요청을 다시 전송하지 않습니다.') }
  const f = doc.fields
  let dated = false
  try {
    if (f.createdAt?.timestampValue && f.updatedAt?.timestampValue && doc.updateTime) {
      timestamp(f.createdAt.timestampValue, ''); timestamp(f.updatedAt.timestampValue, ''); timestamp(doc.updateTime, ''); dated = true
    }
  } catch { /* Current malformed timestamps are not creation acknowledgement evidence. */ }
  const matching = dated && doc.name === `${documents}/users/${request.ownerId}/spaceNotes/${request.id}` && f.title?.stringValue === request.title && f.body?.stringValue === request.body && f.isPinned?.booleanValue === request.pinned
  // Only compare current original fields. No current document can reconstruct a lost past ACK.
  return { outcome: matching ? 'matching' : 'different', observedAt,
    message: matching ? tr('조회 시점에 같은 ID의 제목·본문·고정 여부와 시각 형식이 일치하는 노트가 있습니다. 과거 생성 응답의 증거는 아닙니다. 저장 기록과 기기 초안은 유지합니다.') : tr('같은 ID의 현재 문서가 있지만 제목·본문·고정 여부·시각 형식의 일치를 확인할 수 없습니다. 다른 기기의 수정 여부나 원인을 추정하지 않으며 내용을 덮어쓰지 않습니다.') }
}
