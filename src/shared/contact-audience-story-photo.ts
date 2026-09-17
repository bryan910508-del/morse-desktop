import { backgroundPhotoId } from './chat-background'
import { object, identifier } from './validation'
import { ownStoryPhotoRequest, type OwnStoryPhotoRequest, type OwnStoryPhotoSnapshot } from './own-story-photo'
import { tr } from './i18n'
export interface ContactAudienceStoryPhotoRequest extends OwnStoryPhotoRequest { profileRequestId: string; audienceId: string; privacy: 'contacts' | 'closeFriends' }
export interface ContactAudienceStoryPhotoSnapshot extends ContactAudienceStoryPhotoRequest { ownerId: string; media: OwnStoryPhotoSnapshot | null }
export function contactAudienceStoryPhotoRequest(raw: unknown): ContactAudienceStoryPhotoRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['presentation', 'selectionId', 'requestId', 'storyId', 'version', 'profileRequestId', 'audienceId', 'privacy'].includes(key)) || (v.privacy !== 'contacts' && v.privacy !== 'closeFriends') || (v.presentation !== 'image' && v.presentation !== 'video-poster')) throw new Error(tr('현재 청중 사진 스토리에서 다시 선택해 주세요.'))
  const { profileRequestId, audienceId, privacy, ...photo } = v
  return { ...ownStoryPhotoRequest(photo), profileRequestId: identifier(profileRequestId), audienceId: backgroundPhotoId(audienceId), privacy }
}
