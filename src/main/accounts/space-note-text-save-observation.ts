import type { NoteTextSaveObservation, NoteTextSaveRequest } from '../../shared/space-note-text-save'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { noteFromDocument } from './space-notes'
import { tr } from '../../shared/i18n'
export function observeNoteTextSave(request: NoteTextSaveRequest, doc: FirestoreDocument | null): NoteTextSaveObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, message: tr('조회 시점에 이 노트 문서가 없습니다. 과거 수정 실패·취소·삭제 원인의 증거가 아니며 요청을 다시 전송하지 않습니다.') }
  if (doc.name !== `${documents}/users/${request.ownerId}/spaceNotes/${request.noteId}`) throw new Error('Current note path mismatch')
  const current = noteFromDocument(doc, request.ownerId)
  if (!current.version) throw new Error('Missing current note version')
  if (current.title === request.draft.title && current.body === request.draft.body) return { outcome: 'matching', observedAt, message: tr('조회 시점에 제목·본문이 요청한 변경 내용과 같습니다. 과거 수정 ACK의 증거는 아닙니다. 수정 기록과 기기 초안을 그대로 유지합니다.') }
  if (current.version === request.draft.baseVersion && current.title === request.draft.baseTitle && current.body === request.draft.baseBody) return { outcome: 'original', observedAt, message: tr('조회 시점에 편집 시작 원문과 문서 버전이 그대로입니다. 아직 처리 중인 요청의 최종 실패나 취소를 뜻하지 않으며 자동 재전송하지 않습니다.') }
  return { outcome: 'different', observedAt, message: tr('현재 노트의 내용이나 버전이 편집 시작 원문 및 요청한 변경과 다릅니다. 원인이나 다른 기기의 수정 여부를 추정하지 않으며 내용을 덮어쓰지 않습니다.') }
}
