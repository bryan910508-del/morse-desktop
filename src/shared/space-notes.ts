import { identifier, object } from './validation'
import type { MessagePosition } from './model'
import { tr } from './i18n'
export interface SpaceNoteRow { id: string; version: string; title: string; preview: string; updated: MessagePosition; created: MessagePosition | null; pinned: boolean | null }
export interface SpaceNoteDetail extends SpaceNoteRow { body: string }
export interface SpaceNotesPage { number: number; canPrevious: boolean; older: { noteId: string; version: string } | null }
export interface SpaceNotesSnapshot { revision: string | null; page: SpaceNotesPage; requestId: string | null; status: 'idle' | 'loading' | 'ready' | 'error'; message: string; limited: boolean; rows: SpaceNoteRow[]; selected: SpaceNoteDetail | null }
export interface SpaceNoteSelection { requestId: string; noteId: string | null; version: string | null }
export function spaceNoteSelection(raw: unknown): SpaceNoteSelection {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'noteId', 'version'].includes(k))) throw new Error(tr('현재 노트 목록에서 다시 선택해 주세요.'))
  const requestId = identifier(v.requestId)
  if (v.noteId === null && v.version === null) return { requestId, noteId: null, version: null }
  if (typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 노트 버전을 다시 확인해 주세요.'))
  return { requestId, noteId: identifier(v.noteId), version: v.version }
}

export interface SpaceNotesPageRequest { requestId: string; nextRequestId: string; direction: 'older' | 'previous'; noteId: string | null; version: string | null }
export function spaceNotesPageRequest(raw: unknown): SpaceNotesPageRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'nextRequestId', 'direction', 'noteId', 'version'].includes(k)) || (v.direction !== 'older' && v.direction !== 'previous')) throw new Error(tr('현재 노트 페이지에서 다시 이동해 주세요.'))
  const requestId = identifier(v.requestId), nextRequestId = identifier(v.nextRequestId)
  if (requestId === nextRequestId) throw new Error(tr('새 노트 조회 식별자를 확인해 주세요.'))
  if (v.direction === 'previous') {
    if (v.noteId !== null || v.version !== null) throw new Error(tr('이전 페이지 위치는 계정에서 확인합니다.'))
    return { requestId, nextRequestId, direction: v.direction, noteId: null, version: null }
  }
  if (typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 노트 페이지 끝을 다시 확인해 주세요.'))
  return { requestId, nextRequestId, direction: v.direction, noteId: identifier(v.noteId), version: v.version }
}
