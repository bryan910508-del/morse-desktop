import type { NoteRemovalObservation, NoteRemovalRequest } from '../../shared/space-note-removal'
import { documents, type FirestoreDocument } from '../network/firestore-values'
import { noteFromDocument } from './space-notes'
import { tr } from '../../shared/i18n'
export function observeNoteRemoval(request: NoteRemovalRequest, doc: FirestoreDocument | null): NoteRemovalObservation {
  const observedAt = Date.now()
  if (!doc) return { outcome: 'absent', observedAt, message: tr('조회 시점에 이 노트 문서가 없습니다. 과거 삭제 요청의 성공이나 삭제 원인의 증거는 아닙니다. 삭제 기록과 기기 편집 초안을 유지합니다.') }
  if (doc.name !== `${documents}/users/${request.ownerId}/spaceNotes/${request.noteId}`) throw new Error('Current note path mismatch')
  const current = noteFromDocument(doc, request.ownerId)
  if (!current.version) throw new Error('Missing current note version')
  if (current.version === request.version && current.title === request.title && current.body === request.body) return { outcome: 'original', observedAt, message: tr('조회 시점에 삭제 검토 원문과 문서 버전이 그대로입니다. 진행 중인 요청의 최종 실패나 취소를 뜻하지 않으며 삭제를 자동 반복하지 않습니다.') }
  return { outcome: 'different', observedAt, message: tr('현재 노트의 내용이나 버전이 삭제 검토 당시와 다릅니다. 변경 원인이나 재생성 여부를 추정하지 않으며 현재 노트를 삭제하지 않습니다.') }
}
