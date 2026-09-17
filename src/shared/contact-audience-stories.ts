import { identifier, object } from './validation'
import { backgroundPhotoId } from './chat-background'
import type { ContactPublicStory, ContactPublicStoriesPage } from './contact-public-stories'
import { tr } from './i18n'
export interface ContactAudienceStoriesRequest { id: string; profileRequestId: string; audienceId: string; privacy: 'contacts' | 'closeFriends' }
export interface ContactAudienceStoriesPageRequest extends ContactAudienceStoriesRequest { previousId: string; direction: 'previous' | 'next' }
export interface ContactAudienceStoriesResult extends ContactAudienceStoriesRequest { page: ContactPublicStoriesPage; ownerId: string; ownerName: string; outcome: 'ready' | 'unavailable'; rows: ContactPublicStory[]; limited: boolean; observedAt: number; expiresAt: number; message: string }
export function contactAudienceStoriesRequest(raw: unknown): ContactAudienceStoriesRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'profileRequestId', 'audienceId', 'privacy'].includes(key)) || (v.privacy !== 'contacts' && v.privacy !== 'closeFriends')) throw new Error(tr('현재 확인된 청중 범위에서 스토리를 선택해 주세요.'))
  return { id: backgroundPhotoId(v.id), profileRequestId: identifier(v.profileRequestId), audienceId: backgroundPhotoId(v.audienceId), privacy: v.privacy }
}
export function contactAudienceStoriesPageRequest(raw: unknown): ContactAudienceStoriesPageRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'profileRequestId', 'audienceId', 'privacy', 'previousId', 'direction'].includes(key)) || (v.direction !== 'previous' && v.direction !== 'next')) throw new Error(tr('현재 청중 스토리 구간에서 다시 이동해 주세요.'))
  const { previousId, direction, ...rawRequest } = v, request = contactAudienceStoriesRequest(rawRequest), previous = backgroundPhotoId(previousId)
  if (request.id === previous) throw new Error(tr('새 스토리 구간 식별자가 필요합니다.'))
  return { ...request, previousId: previous, direction }
}
