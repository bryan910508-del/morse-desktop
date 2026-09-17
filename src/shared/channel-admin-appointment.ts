import { channelAdminPermissionLabels, type ChannelAdminPermissionKey } from './channel-admins'
import { identifier, object } from './validation'
import { tr } from './i18n'
export type ChannelAdminPermissionValues = Record<ChannelAdminPermissionKey, boolean>
export function emptyChannelAdminPermissions(): ChannelAdminPermissionValues { return Object.fromEntries(Object.keys(channelAdminPermissionLabels).map(key => [key, false])) as ChannelAdminPermissionValues }
export interface ChannelAdminAppointment {
  id: string; requestId: string; subscribersRequestId: string; adminsRequestId: string; channelId: string; version: string; title: string; userId: string; subscriberVersion: string; label: string; permissions: ChannelAdminPermissionValues
}
export interface ChannelAdminAppointmentResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelAdminAppointment(raw: unknown): ChannelAdminAppointment {
  const value = object(raw), version = /^\d{1,12}:\d{1,9}$/
  if (Object.keys(value).some(key => !['id', 'requestId', 'subscribersRequestId', 'adminsRequestId', 'channelId', 'version', 'title', 'userId', 'subscriberVersion', 'label', 'permissions'].includes(key)) ||
    typeof value.version !== 'string' || !version.test(value.version) || typeof value.subscriberVersion !== 'string' || !version.test(value.subscriberVersion) ||
    typeof value.title !== 'string' || !value.title || value.title.length > 512 || typeof value.label !== 'string' || !value.label || value.label.length > 512) throw new Error(tr('최신 구독자 목록에서 관리자를 다시 선택해 주세요.'))
  const rawPermissions = object(value.permissions), keys = Object.keys(channelAdminPermissionLabels)
  if (Object.keys(rawPermissions).length !== keys.length || keys.some(key => typeof rawPermissions[key] !== 'boolean')) throw new Error(tr('새 관리자의 권한 일곱 개를 확인해 주세요.'))
  const permissions = Object.fromEntries(keys.map(key => [key, rawPermissions[key]])) as ChannelAdminPermissionValues
  return { id: identifier(value.id), requestId: identifier(value.requestId), subscribersRequestId: identifier(value.subscribersRequestId), adminsRequestId: identifier(value.adminsRequestId), channelId: identifier(value.channelId), version: value.version,
    title: value.title, userId: identifier(value.userId), subscriberVersion: value.subscriberVersion, label: value.label, permissions }
}
