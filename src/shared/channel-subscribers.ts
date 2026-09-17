import type { MessagePosition } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelSubscribersSelection { requestId: string; channelId: string }
export interface ChannelSubscriberRow { uid: string; version: string | null; name: string | null; handle: string | null; subscribed: MessagePosition | null; photo?: import('./group-photo').GroupPhotoImage | null }
export interface ChannelSubscribersSnapshot extends ChannelSubscribersSelection {
  status: 'loading' | 'ready' | 'blocked' | 'error' | 'limit'
  rows: ChannelSubscriberRow[]
  message: string
}
export function channelSubscribersSelection(raw: unknown): ChannelSubscribersSelection {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'channelId'].includes(key))) throw new Error(tr('구독자 목록을 다시 열어 주세요.'))
  return { requestId: identifier(value.requestId), channelId: identifier(value.channelId) }
}
