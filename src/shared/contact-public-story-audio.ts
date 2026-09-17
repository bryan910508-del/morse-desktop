import { object, identifier } from './validation'
import { ownStoryAudioRequest, type OwnStoryAudioRequest, type OwnStoryAudioSnapshot } from './own-story-audio'
import { tr } from './i18n'
export interface ContactPublicStoryAudioRequest extends OwnStoryAudioRequest { profileRequestId: string }
export interface ContactPublicStoryAudioSnapshot extends ContactPublicStoryAudioRequest { ownerId: string; media: OwnStoryAudioSnapshot | null }
export function contactPublicStoryAudioRequest(raw: unknown): ContactPublicStoryAudioRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['selectionId', 'requestId', 'storyId', 'version', 'profileRequestId'].includes(key))) throw new Error(tr('현재 공개 스토리의 첨부 오디오를 다시 선택해 주세요.'))
  const { profileRequestId, ...audio } = v
  return { ...ownStoryAudioRequest(audio), profileRequestId: identifier(profileRequestId) }
}
