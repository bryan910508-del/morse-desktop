import type { MessagePosition } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'
export type StoryPrivacy = 'contacts' | 'everyone' | 'closeFriends'
export const storyPrivacyNames: Record<StoryPrivacy, string> = { contacts: tr('연락처'), everyone: tr('전체 공개'), closeFriends: tr('친한 친구') }
export interface OwnStoriesRequest { requestId: string; privacy: StoryPrivacy }
export interface OwnStorySelection { requestId: string; storyId: string | null; version: string | null }
export interface OwnStoryRow { audio: 'none' | 'attached' | 'unknown'; hasThumbnail: boolean; id: string; version: string; privacy: StoryPrivacy; preview: string; mediaType: 'image' | 'video' | 'unknown'; created: MessagePosition; expires: MessagePosition }
export interface OwnStoryDetail extends OwnStoryRow { caption: string }
export interface OwnStoriesPage { number: number; canPrevious: boolean; next: { storyId: string; version: string } | null }
export interface OwnStoriesSnapshot { view: 'list' | 'single'; page: OwnStoriesPage; audio: import('./own-story-audio').OwnStoryAudioSnapshot | null; video: import('./own-story-video').OwnStoryVideoSnapshot | null; photo: import('./own-story-photo').OwnStoryPhotoSnapshot | null; requestId: string | null; privacy: StoryPrivacy | null; status: 'idle' | 'loading' | 'ready' | 'error'; rows: OwnStoryRow[]; selected: OwnStoryDetail | null; limited: boolean; observedAt: number | null; message: string }
export function ownStoriesRequest(raw: unknown): OwnStoriesRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'privacy'].includes(k)) || typeof v.privacy !== 'string' || !['contacts', 'everyone', 'closeFriends'].includes(v.privacy)) throw new Error(tr('내 스토리의 공개 범위를 선택해 주세요.'))
  return { requestId: identifier(v.requestId), privacy: v.privacy as StoryPrivacy }
}
export function ownStorySelection(raw: unknown): OwnStorySelection {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'storyId', 'version'].includes(k))) throw new Error(tr('현재 내 스토리 목록에서 다시 선택해 주세요.'))
  const requestId = identifier(v.requestId)
  if (v.storyId === null && v.version === null) return { requestId, storyId: null, version: null }
  if (typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 스토리의 버전을 확인해 주세요.'))
  return { requestId, storyId: identifier(v.storyId), version: v.version }
}

export interface OwnStoriesPageRequest { requestId: string; nextRequestId: string; direction: 'next' | 'previous'; storyId: string | null; version: string | null }
export function ownStoriesPageRequest(raw: unknown): OwnStoriesPageRequest {
  const v = object(raw)
  if (Object.keys(v).some(k => !['requestId', 'nextRequestId', 'direction', 'storyId', 'version'].includes(k)) || (v.direction !== 'next' && v.direction !== 'previous')) throw new Error(tr('현재 내 스토리 페이지에서 다시 이동해 주세요.'))
  const requestId = identifier(v.requestId), nextRequestId = identifier(v.nextRequestId)
  if (requestId === nextRequestId) throw new Error(tr('새 스토리 조회 식별자를 확인해 주세요.'))
  if (v.direction === 'previous') {
    if (v.storyId !== null || v.version !== null) throw new Error(tr('이전 페이지 위치는 계정에서 확인합니다.'))
    return { requestId, nextRequestId, direction: v.direction, storyId: null, version: null }
  }
  if (typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 스토리 페이지 끝을 다시 확인해 주세요.'))
  return { requestId, nextRequestId, direction: v.direction, storyId: identifier(v.storyId), version: v.version }
}
