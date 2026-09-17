import type { MessagePosition } from './model'
import { identifier, object } from './validation'
import { tr } from './i18n'
export const channelAdminPermissionLabels = {
  canPostMessages: tr('메시지·게시물 작성'), canEditMessages: tr('메시지 편집'), canDeleteMessages: tr('메시지 삭제'), canManageSubscribers: tr('구독자 관리'),
  canPinMessages: tr('메시지 고정'), canEditChannelInfo: tr('채널 정보 편집'), canAddAdmins: tr('관리자 추가')
} as const
export type ChannelAdminPermissionKey = keyof typeof channelAdminPermissionLabels
export type ChannelAdminPermissionInfo = Record<ChannelAdminPermissionKey, { value: boolean | null; origin: 'stored' | 'default' | 'unknown' }>
export interface ChannelAdminsSelection { requestId: string; channelId: string }
export interface ChannelAdminRow { uid: string; version: string | null; name: string | null; appointed: MessagePosition | null; permissions: ChannelAdminPermissionInfo; indexed: boolean | null; photo?: import('./group-photo').GroupPhotoImage | null }
export interface ChannelAdminsSnapshot extends ChannelAdminsSelection {
  status: 'loading' | 'ready' | 'blocked' | 'error' | 'limit'
  rows: ChannelAdminRow[]
  indexOrigin: 'stored' | 'default' | 'unknown'
  indexOnlyCount: number | null
  message: string
}
export function channelAdminsSelection(raw: unknown): ChannelAdminsSelection {
  const value = object(raw)
  if (Object.keys(value).some(key => !['requestId', 'channelId'].includes(key))) throw new Error(tr('관리자 목록을 다시 열어 주세요.'))
  return { requestId: identifier(value.requestId), channelId: identifier(value.channelId) }
}
