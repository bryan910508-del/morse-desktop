import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface ContactPublicStoriesRequest { id: string; profileRequestId: string }
export interface ContactPublicStory { audio: 'none' | 'attached' | 'unknown'; hasThumbnail: boolean; id: string; version: string; caption: string; mediaType: 'image' | 'video' | 'unknown'; createdAt: number; expiresAt: number }
export interface ContactPublicStoriesPage { number: number; canPrevious: boolean; canNext: boolean }
export interface ContactPublicStoriesResult extends ContactPublicStoriesRequest { page: ContactPublicStoriesPage; ownerId: string; ownerName: string; outcome: 'ready' | 'unavailable'; rows: ContactPublicStory[]; limited: boolean; observedAt: number; message: string }
export function contactPublicStoriesRequest(raw: unknown): ContactPublicStoriesRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'profileRequestId'].includes(key))) throw new Error(tr('현재 연락처에서 스토리를 다시 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), profileRequestId: identifier(v.profileRequestId) }
}

export interface ContactPublicStoriesPageRequest extends ContactPublicStoriesRequest { previousId: string; direction: 'next' | 'previous' }
export function contactPublicStoriesPageRequest(raw: unknown): ContactPublicStoriesPageRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'profileRequestId', 'previousId', 'direction'].includes(key)) || (v.direction !== 'next' && v.direction !== 'previous')) throw new Error(tr('현재 공개 스토리 구간에서 다시 이동해 주세요.'))
  const next = contactPublicStoriesRequest({ id: v.id, profileRequestId: v.profileRequestId }), previousId = backgroundPhotoId(v.previousId)
  if (next.id === previousId) throw new Error(tr('새 스토리 조회 식별자가 필요합니다.'))
  return { ...next, previousId, direction: v.direction }
}
