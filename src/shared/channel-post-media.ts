import { identifier, object } from './validation'
import { tr } from './i18n'

export interface ChannelPostMediaItem { index: number; kind: 'image' | 'video' | 'unsupported'; available: boolean; videoAvailable: boolean
  // The picture drawn inside the post, as Telegram draws a channel post's media in the channel itself.
  picture?: import('./channel-home').ChannelHomeImage | null }
export interface ChannelPostMediaRequest {
  requestId: string; channelId: string; postId: string; revision: string; index: number; selectionId: string; presentation: 'image' | 'video'
}
export interface ChannelPostMediaSnapshot extends ChannelPostMediaRequest {
  status: 'loading' | 'ready' | 'error'; url: string | null; message: string; loaded: number; total: number | null
}
export function channelPostMediaRequest(raw: unknown): ChannelPostMediaRequest {
  const v = object(raw)
  if (Object.keys(v).some(key => !['requestId', 'channelId', 'postId', 'revision', 'index', 'selectionId', 'presentation'].includes(key)) ||
      (v.presentation !== 'image' && v.presentation !== 'video') ||
      !Number.isSafeInteger(v.index) || (v.index as number) < 0 || (v.index as number) >= 20 ||
      typeof v.revision !== 'string' || !/^[a-f0-9]{64}$/.test(v.revision)) throw new Error(tr('게시물 미디어를 다시 선택해 주세요.'))
  return { requestId: identifier(v.requestId), channelId: identifier(v.channelId), postId: identifier(v.postId),
    revision: v.revision, index: v.index as number, selectionId: identifier(v.selectionId), presentation: v.presentation }
}
