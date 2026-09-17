import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { storyCaptionLinkRequest, type StoryCaptionLinkRequest } from './story-caption-link'
import { tr } from './i18n'
export interface ContactAudienceStoryLinkRequest extends StoryCaptionLinkRequest { profileRequestId: string; audienceId: string; privacy: 'contacts' | 'closeFriends' }
export function contactAudienceStoryLinkRequest(raw: unknown): ContactAudienceStoryLinkRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['profileRequestId', 'audienceId', 'privacy', 'requestId', 'storyId', 'version', 'url'].includes(key)) || (v.privacy !== 'contacts' && v.privacy !== 'closeFriends')) throw new Error(tr('현재 청중 스토리 설명에서 링크를 선택해 주세요.'))
  const { profileRequestId, audienceId, ...target } = v, link = storyCaptionLinkRequest(target)
  return { ...link, privacy: v.privacy, profileRequestId: identifier(profileRequestId), audienceId: backgroundPhotoId(audienceId) }
}
