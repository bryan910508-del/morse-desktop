import { object, identifier } from './validation'
import { storyCaptionLinkRequest } from './story-caption-link'
import { tr } from './i18n'
export interface ContactPublicStoryLinkRequest { profileRequestId: string; requestId: string; storyId: string; version: string; url: string }
export function contactPublicStoryLinkRequest(raw: unknown): ContactPublicStoryLinkRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['profileRequestId', 'requestId', 'storyId', 'version', 'url'].includes(key))) throw new Error(tr('현재 공개 스토리 설명에서 링크를 선택해 주세요.'))
  const { profileRequestId, ...target } = v
  const { privacy: _privacy, ...link } = storyCaptionLinkRequest({ ...target, privacy: 'everyone' })
  return { ...link, profileRequestId: identifier(profileRequestId) }
}
