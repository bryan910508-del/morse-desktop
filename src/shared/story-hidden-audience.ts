import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionDraftTarget, type StoryCaptionDraftTarget } from './story-caption-drafts'
import { tr } from './i18n'
export interface StoryHiddenAudienceRequest extends StoryCaptionDraftTarget { id: string; requestId: string; version: string }
export interface StoryHiddenAudienceResult extends StoryHiddenAudienceRequest {
  outcome: 'ready' | 'changed' | 'absent' | 'expired' | 'unavailable'
  observedAt: number
  current: { hiddenFrom: string[]; field: 'missing' | 'stored'; expiresAt: number } | null
  message: string
}
export function storyHiddenAudienceRequest(raw: unknown): StoryHiddenAudienceRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'requestId', 'storyId', 'privacy', 'version'].includes(key)) || typeof v.version !== 'string' || !/^\d{1,12}:\d{1,9}$/.test(v.version)) throw new Error(tr('현재 내 스토리에서 숨김 설정을 확인해 주세요.'))
  return { ...storyCaptionDraftTarget({ storyId: v.storyId, privacy: v.privacy }), id: backgroundPhotoId(v.id), requestId: identifier(v.requestId), version: v.version }
}
