import { object } from './validation'
import { backgroundPhotoId } from './chat-background'
import type { StoryPrivacy } from './own-stories'
import { tr } from './i18n'
export interface StoryPublicationNavigation { id: string; state: 'submitted' | 'confirmed' | 'rejected'; requestId: string }
export interface OwnStoryOpened { requestId: string; privacy: StoryPrivacy }
export function storyPublicationNavigation(raw: unknown): StoryPublicationNavigation {
  const v = object(raw)
  if (Object.keys(v).some(key => !['id', 'state', 'requestId'].includes(key)) || typeof v.state !== 'string' || !['submitted', 'confirmed', 'rejected'].includes(v.state)) throw new Error(tr('현재 게시 기록에서 다시 열어 주세요.'))
  return { id: backgroundPhotoId(v.id), requestId: backgroundPhotoId(v.requestId), state: v.state as StoryPublicationNavigation['state'] }
}
