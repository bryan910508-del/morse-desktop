import { object, identifier } from './validation'
import { ownStoryPhotoRequest, type OwnStoryPhotoRequest, type OwnStoryPhotoSnapshot } from './own-story-photo'
import { tr } from './i18n'
export interface ContactPublicStoryPhotoRequest extends OwnStoryPhotoRequest { profileRequestId: string }
export interface ContactPublicStoryPhotoSnapshot extends ContactPublicStoryPhotoRequest { ownerId: string; media: OwnStoryPhotoSnapshot | null }
export function contactPublicStoryPhotoRequest(raw: unknown): ContactPublicStoryPhotoRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['presentation', 'selectionId', 'requestId', 'storyId', 'version', 'profileRequestId'].includes(key)) || (v.presentation !== 'image' && v.presentation !== 'video-poster')) throw new Error(tr('현재 공개 사진 스토리에서 다시 선택해 주세요.'))
  const { profileRequestId, ...photo } = v
  return { ...ownStoryPhotoRequest(photo), profileRequestId: identifier(profileRequestId) }
}
