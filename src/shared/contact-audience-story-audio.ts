import { backgroundPhotoId } from './chat-background'
import { object, identifier } from './validation'
import { ownStoryAudioRequest, type OwnStoryAudioRequest, type OwnStoryAudioSnapshot } from './own-story-audio'
import { tr } from './i18n'
export interface ContactAudienceStoryAudioRequest extends OwnStoryAudioRequest { profileRequestId: string; audienceId: string; privacy: 'contacts' | 'closeFriends' }
export interface ContactAudienceStoryAudioSnapshot extends ContactAudienceStoryAudioRequest { ownerId: string; media: OwnStoryAudioSnapshot | null }
export function contactAudienceStoryAudioRequest(raw: unknown): ContactAudienceStoryAudioRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['selectionId', 'requestId', 'storyId', 'version', 'profileRequestId', 'audienceId', 'privacy'].includes(key)) || (v.privacy !== 'contacts' && v.privacy !== 'closeFriends')) throw new Error(tr('현재 청중 스토리의 첨부 오디오에서 다시 선택해 주세요.'))
  const { profileRequestId, audienceId, privacy, ...audio } = v
  return { ...ownStoryAudioRequest(audio), profileRequestId: identifier(profileRequestId), audienceId: backgroundPhotoId(audienceId), privacy }
}
