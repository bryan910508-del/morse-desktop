import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { tr } from './i18n'
export interface ContactStoryAudienceRequest { id: string; profileRequestId: string }
export interface ContactStoryAudienceSnapshot extends ContactStoryAudienceRequest {
  ownerId: string; status: 'loading' | 'ready'; contacts: boolean | null; closeFriends: boolean | null
  observedAt: number | null; expiresAt: number; message: string
}
export function contactStoryAudienceRequest(raw: unknown): ContactStoryAudienceRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'profileRequestId'].includes(key))) throw new Error(tr('현재 연락처에서 스토리 청중을 확인해 주세요.'))
  return { id: backgroundPhotoId(v.id), profileRequestId: identifier(v.profileRequestId) }
}
