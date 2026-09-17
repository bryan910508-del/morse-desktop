import { object, identifier } from './validation'
import { ownStoryVideoRequest, type OwnStoryVideoRequest, type OwnStoryVideoSnapshot } from './own-story-video'
import { tr } from './i18n'
export interface ContactPublicStoryVideoRequest extends OwnStoryVideoRequest { profileRequestId: string }
export interface ContactPublicStoryVideoSnapshot extends ContactPublicStoryVideoRequest { ownerId: string; media: OwnStoryVideoSnapshot | null }
export function contactPublicStoryVideoRequest(raw: unknown): ContactPublicStoryVideoRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['mode', 'selectionId', 'requestId', 'storyId', 'version', 'profileRequestId'].includes(key)) || (v.mode !== 'original' && v.mode !== 'with-audio')) throw new Error(tr('현재 공개 영상과 오디오 구성에서 다시 선택해 주세요.'))
  const { profileRequestId, ...video } = v
  return { ...ownStoryVideoRequest(video), profileRequestId: identifier(profileRequestId) }
}
