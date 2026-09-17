import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { noteEditComparisonRequest, type NoteEditComparisonRequest, type NoteEditCurrent } from './space-note-edit-comparison'
import { noteEditDraft, type NoteEditDraft } from './space-note-edit-drafts'
import { tr } from './i18n'
export interface NoteEditRebaseRequest extends NoteEditComparisonRequest { revision: string; draft: NoteEditDraft; current: NoteEditCurrent; mode: 'keep-input' | 'use-current' }
export function noteEditRebaseRequest(raw: unknown): NoteEditRebaseRequest {
  const v = object(raw), current = object(v.current)
  if (Object.keys(v).some(k => !['id', 'noteId', 'draftRevision', 'revision', 'draft', 'current', 'mode'].includes(k)) || Object.keys(current).some(k => !['version', 'title', 'body'].includes(k)) || (v.mode !== 'keep-input' && v.mode !== 'use-current')) throw new Error(tr('원문을 바꾸는 방법과 현재 서버 내용을 다시 확인해 주세요.'))
  const target = noteEditComparisonRequest({ id: v.id, noteId: v.noteId, draftRevision: v.draftRevision }), revision = backgroundPhotoId(v.revision)
  if (revision === target.draftRevision) throw new Error(tr('새 기기 저장 버전이 필요합니다.'))
  const checked = noteEditDraft({ baseVersion: current.version, baseTitle: current.title, baseBody: current.body, title: current.title, body: current.body })
  return { ...target, revision, draft: noteEditDraft(v.draft), current: { version: checked.baseVersion, title: checked.title, body: checked.body }, mode: v.mode }
}
export function rebasedNoteEditDraft(request: NoteEditRebaseRequest): NoteEditDraft {
  return { baseVersion: request.current.version, baseTitle: request.current.title, baseBody: request.current.body, title: request.mode === 'keep-input' ? request.draft.title : request.current.title, body: request.mode === 'keep-input' ? request.draft.body : request.current.body }
}
