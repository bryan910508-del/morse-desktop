import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface NoteRemovalPrepare { id: string; requestId: string; noteId: string; version: string }
export interface NoteRemovalRequest { id: string; noteId: string; version: string; title: string; body: string; ownerId: string }
export type NoteRemovalState = 'prepared' | 'submitted' | 'confirmed' | 'rejected'
export interface PendingNoteRemoval extends NoteRemovalRequest { state: NoteRemovalState }
export interface NoteRemovalObservation { outcome: 'original' | 'different' | 'absent' | 'unavailable'; observedAt: number; message: string }
export interface NoteRemovalSnapshot { observation: NoteRemovalObservation | null; canCheck: boolean; status: 'loading' | 'ready' | 'error'; busy: boolean; canSend: boolean; pending: PendingNoteRemoval | null; message: string }
export interface NoteRemovalAction { id: string; state: NoteRemovalState; action: 'send' | 'check' | 'dismiss' }
function version(raw: unknown): string { if (typeof raw !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(raw)) throw new Error(tr('현재 노트의 버전을 확인해 주세요.')); return raw }
export function noteRemovalPrepare(raw: unknown): NoteRemovalPrepare {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'requestId', 'noteId', 'version'].includes(k))) throw new Error(tr('현재 노트에서 삭제할 내용을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), noteId: identifier(v.noteId), version: version(v.version) }
}
export function noteRemovalRequest(raw: unknown): NoteRemovalRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'noteId', 'version', 'title', 'body', 'ownerId'].includes(k)) || typeof v.title !== 'string' || v.title.length > 200 || typeof v.body !== 'string' || v.body.length > 120000) throw new Error(tr('삭제할 노트 원문과 현재 계정을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), noteId: identifier(v.noteId), version: version(v.version), title: v.title, body: v.body, ownerId: identifier(v.ownerId) }
}
export function noteRemovalAction(raw: unknown): NoteRemovalAction {
  const v = object(raw)
  if (Object.keys(v).some(k => !['id', 'state', 'action'].includes(k)) || typeof v.state !== 'string' || !['prepared', 'submitted', 'confirmed', 'rejected'].includes(v.state) || (v.action !== 'send' && v.action !== 'check' && v.action !== 'dismiss')) throw new Error(tr('최신 노트 삭제 기록을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), state: v.state as NoteRemovalState, action: v.action }
}
