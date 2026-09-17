import type { MessagePosition } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'
export interface ChannelJoinRequestsSelection { requestId: string; channelId: string }
// The server writes a copy of the requester's profile into the request, because a channel's owner cannot read the
// users document of somebody who is not their contact.
export interface ChannelJoinRequestRow { uid: string; version: string | null; requested: MessagePosition | null
  name: string | null; handle: string | null; photo?: import('./group-photo').GroupPhotoImage | null }
export interface ChannelJoinRequestsSnapshot extends ChannelJoinRequestsSelection {
  status: 'loading' | 'ready' | 'blocked' | 'error' | 'limit'
  rows: ChannelJoinRequestRow[]
  message: string
}
export function channelJoinRequestsSelection(raw: unknown): ChannelJoinRequestsSelection {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'channelId'].includes(key))) throw new Error(tr('가입 요청 목록을 다시 열어 주세요.'))
  return { requestId: identifier(value.requestId), channelId: identifier(value.channelId) }
}
