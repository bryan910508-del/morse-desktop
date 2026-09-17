import type { MessageKind, MessagePosition } from './model'
import { tr } from './i18n'

export interface SearchHit { id: string; position: MessagePosition; sender: string; kind: MessageKind; snippet: string; message?: import('./model').ChatMessage }
// Telegram's shared media filters (InputMessagesFilterPhotoVideo / Document / Url) and iOS ProfileView's 미디어·파일·링크 tabs.
export type SharedMediaFilter = 'media' | 'files' | 'links'
export function sharedMediaFilter(value: unknown): SharedMediaFilter {
  if (value !== 'media' && value !== 'files' && value !== 'links') throw new Error(tr('보기를 다시 선택해 주세요.'))
  return value
}
export interface SearchSnapshot {
  id: string
  query: string
  revision: number
  status: 'loading' | 'ready' | 'error' | 'closed'
  hits: SearchHit[]
  scanned: number
  hasMore: boolean
  limited: boolean
  message: string
}
export function searchText(value: string): string { return value.normalize('NFC').replace(/\s+/gu, ' ').trim() }
export function searchFold(value: string): string { return searchText(value).toLowerCase() }
export function searchQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) throw new Error(tr('검색어는 200자까지 입력할 수 있습니다.'))
  const query = searchText(value)
  if (!query) throw new Error(tr('검색어를 입력해 주세요.'))
  return query
}
