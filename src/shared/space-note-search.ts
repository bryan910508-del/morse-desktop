import { backgroundPhotoId } from './chat-background'
import { identifier, object } from './validation'
import { searchQuery } from './search'
import { tr } from './i18n'
export interface NotePageSearch { requestId: string; revision: string; query: string }
export interface NotePageSearchResult extends NotePageSearch { scanned: number; hits: { id: string; version: string; field: 'title' | 'body' }[] }
export function notePageSearch(raw: unknown): NotePageSearch {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'revision', 'query'].includes(k))) throw new Error(tr('현재 노트 페이지에서 검색해 주세요.'))
  return { requestId: identifier(v.requestId), revision: backgroundPhotoId(v.revision), query: searchQuery(v.query) }
}
