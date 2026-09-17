import { backgroundPhotoId } from './chat-background'
import { noteDraftContent, type NoteDraftContent } from './space-note-drafts'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface NoteCreationPrepare extends NoteDraftContent { id: string; draftId: string; draftRevision: string }
export interface NoteCreationRequest extends NoteCreationPrepare { ownerId: string }
export type NoteCreationState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingNoteCreation extends NoteCreationRequest { state: NoteCreationState }
export interface NoteCreationObservation { outcome: 'matching' | 'different' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface NoteCreationSnapshot { observation: NoteCreationObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingNoteCreation | null; message: string }
export interface NoteCreationAction { id: string; state: NoteCreationState; action: 'send' | 'check' | 'dismiss' }
export interface NoteCreatedNavigation { requestId: string; noteId: string; version: string; state: 'submitted' | 'confirmed' | 'rejected' }
const prepareKeys = ['id', 'draftId', 'draftRevision', 'title', 'body', 'pinned']
export function noteCreationPrepare(raw: unknown): NoteCreationPrepare {
  const v = object(raw), content = noteDraftContent({ title: v.title, body: v.body, pinned: v.pinned })
  if (Object.keys(v).some(k => !prepareKeys.includes(k))) throw new Error(tr('저장할 새 노트 초안을 다시 확인해 주세요.'))
  const id = backgroundPhotoId(v.id), draftId = backgroundPhotoId(v.draftId)
  if (id === draftId) throw new Error(tr('새 노트 요청 식별자가 필요합니다.'))
  return { id, draftId, draftRevision: backgroundPhotoId(v.draftRevision), ...content }
}
export function noteCreationRequest(raw: unknown): NoteCreationRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => ![...prepareKeys, 'ownerId'].includes(k))) throw new Error(tr('현재 계정의 노트 저장 내용을 확인해 주세요.'))
  return { ...noteCreationPrepare(Object.fromEntries(prepareKeys.map(k => [k, v[k]]))), ownerId: identifier(v.ownerId) }
}
export function noteCreationAction(raw: unknown): NoteCreationAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 노트 저장 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as NoteCreationState, action: v.action }
}
