import { object, identifier } from './validation'
import { backgroundPhotoId } from './chat-background'
import { ownStoryAudioRequest, type OwnStoryAudioRequest } from './own-story-audio'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface ContactStoryPhotoAudioRequest extends OwnStoryAudioRequest { profileRequestId: string; privacy: StoryPrivacy; audienceId: string | null }
export interface ContactStoryPhotoAudioSnapshot extends ContactStoryPhotoAudioRequest { ownerId: string; status: 'loading' | 'ready'; photoUrl: string | null; audioUrl: string | null; loaded: number; total: number | null; expiresAt: number }
export function contactStoryPhotoAudioRequest(raw: unknown): ContactStoryPhotoAudioRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['selectionId', 'profileRequestId', 'requestId', 'storyId', 'version', 'privacy', 'audienceId'].includes(key)) || (v.privacy !== 'everyone' && v.privacy !== 'contacts' && v.privacy !== 'closeFriends') || (v.privacy === 'everyone' && v.audienceId !== null)) throw new Error(tr('현재 사진 스토리와 첨부 오디오를 선택해 주세요.'))
  const { profileRequestId, privacy, audienceId, ...audio } = v
  return { ...ownStoryAudioRequest(audio), profileRequestId: identifier(profileRequestId), privacy, audienceId: privacy === 'everyone' ? null : backgroundPhotoId(audienceId) }
}
