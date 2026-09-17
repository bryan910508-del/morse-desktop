import { identifier, object } from './validation'
import { tr } from './i18n'

// iOS PostLikersView: who liked a channel post. The name always shows; the @id only for my contacts (others see
// @••••••), and a non-contact in private mode shows as «비공개 사용자».
export interface PostLiker { uid: string; name: string; handle: string; private: boolean; photo?: import('./group-photo').GroupPhotoImage | null }
export interface PostLikersSnapshot { requestId: string; channelId: string; postId: string; status: 'loading' | 'ready' | 'error'; partial: boolean; items: PostLiker[]; message: string }
export interface PostLikersRequest { requestId: string; channelId: string; postId: string }
export function postLikersRequest(raw: unknown): PostLikersRequest {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'channelId', 'postId'].includes(key))) throw new Error(tr('게시물을 다시 선택해 주세요.'))
  return { requestId: identifier(value.requestId), channelId: identifier(value.channelId), postId: identifier(value.postId) }
}
