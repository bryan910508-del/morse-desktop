import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface NoteEditComparisonRequest { id: string; noteId: string; draftRevision: string }
export interface NoteEditCurrent { version: string; title: string; body: string }
export interface NoteEditComparisonResult extends NoteEditComparisonRequest { outcome: 'unchanged' | 'changed' | 'absent' | 'unavailable'; observedAt: number; current: NoteEditCurrent | null; message: string }
export function noteEditComparisonRequest(raw: unknown): NoteEditComparisonRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'noteId', 'draftRevision'].includes(k))) throw new Error(tr('현재 저장된 편집 초안에서 비교해 주세요.'))
  return { id: backgroundPhotoId(v.id), noteId: identifier(v.noteId), draftRevision: backgroundPhotoId(v.draftRevision) }
}
