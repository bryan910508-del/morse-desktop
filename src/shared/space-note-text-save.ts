import { backgroundPhotoId } from './chat-background'
import { noteEditDraft, type NoteEditDraft } from './space-note-edit-drafts'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface NoteTextSavePrepare { id: string; noteId: string; draftRevision: string; draft: NoteEditDraft }
export interface NoteTextSaveRequest extends NoteTextSavePrepare { ownerId: string }
export type NoteTextSaveState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingNoteTextSave extends NoteTextSaveRequest { state: NoteTextSaveState }
export interface NoteTextSaveObservation { outcome: 'matching' | 'original' | 'different' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface NoteTextSaveSnapshot { observation: NoteTextSaveObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingNoteTextSave | null; message: string }
export interface NoteTextSaveAction { id: string; state: NoteTextSaveState; action: 'send' | 'check' | 'dismiss' }
const prepareKeys = ['id', 'noteId', 'draftRevision', 'draft']
export function noteTextSavePrepare(raw: unknown): NoteTextSavePrepare {
  const v = object(raw), draft = noteEditDraft(v.draft)
  if (Object.keys(v).some(k => !prepareKeys.includes(k)) || (draft.title === draft.baseTitle && draft.body === draft.baseBody)) throw new Error(tr('원문에서 변경한 제목·본문을 먼저 기기에 저장해 주세요.'))
  return { id: backgroundPhotoId(v.id), noteId: identifier(v.noteId), draftRevision: backgroundPhotoId(v.draftRevision), draft }
}
export function noteTextSaveRequest(raw: unknown): NoteTextSaveRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => ![...prepareKeys, 'ownerId'].includes(k))) throw new Error(tr('현재 계정의 노트 저장 내용을 확인해 주세요.'))
  return { ...noteTextSavePrepare(Object.fromEntries(prepareKeys.map(k => [k, v[k]]))), ownerId: identifier(v.ownerId) }
}
export function noteTextSaveAction(raw: unknown): NoteTextSaveAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 노트 수정 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as NoteTextSaveState, action: v.action }
}
