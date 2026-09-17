import { backgroundPhotoId } from './chat-background'
import { object, identifier } from './validation'
import { ownStoryVideoRequest, type OwnStoryVideoRequest, type OwnStoryVideoSnapshot } from './own-story-video'
import { tr } from './i18n'
export interface ContactAudienceStoryVideoRequest extends OwnStoryVideoRequest { profileRequestId: string; audienceId: string; privacy: 'contacts' | 'closeFriends' }
export interface ContactAudienceStoryVideoSnapshot extends ContactAudienceStoryVideoRequest { ownerId: string; media: OwnStoryVideoSnapshot | null }
export function contactAudienceStoryVideoRequest(raw: unknown): ContactAudienceStoryVideoRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['mode', 'selectionId', 'requestId', 'storyId', 'version', 'profileRequestId', 'audienceId', 'privacy'].includes(key)) || (v.privacy !== 'contacts' && v.privacy !== 'closeFriends') || (v.mode !== 'original' && v.mode !== 'with-audio')) throw new Error(tr('현재 청중 영상과 오디오 구성에서 다시 선택해 주세요.'))
  const { profileRequestId, audienceId, privacy, ...video } = v
  return { ...ownStoryVideoRequest(video), profileRequestId: identifier(profileRequestId), audienceId: backgroundPhotoId(audienceId), privacy }
}
