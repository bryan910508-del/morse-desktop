import { channelAdminPermissionLabels, type ChannelAdminPermissionKey } from './channel-admins'
import { identifier, object } from './validation'
import { tr } from './i18n'
export type ChannelAdminPermissionChanges = Partial<Record<ChannelAdminPermissionKey, boolean>>
export interface ChannelAdminPermissionsEdit {
  id: string; requestId: string; listRequestId: string; channelId: string; version: string; title: string; userId: string; adminVersion: string; label: string; changes: ChannelAdminPermissionChanges
}
export interface ChannelAdminPermissionsResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelAdminPermissionsEdit(raw: unknown): ChannelAdminPermissionsEdit {
  const value = object(raw), version = /^\d{1,12}:\d{1,9}$/
  if (Object.keys(value).some(key => !['id', 'requestId', 'listRequestId', 'channelId', 'version', 'title', 'userId', 'adminVersion', 'label', 'changes'].includes(key)) ||
    typeof value.version !== 'string' || !version.test(value.version) || typeof value.adminVersion !== 'string' || !version.test(value.adminVersion) ||
    typeof value.title !== 'string' || !value.title || value.title.length > 512 || typeof value.label !== 'string' || !value.label || value.label.length > 512) throw new Error(tr('최신 관리자 목록에서 다시 편집해 주세요.'))
  const rawChanges = object(value.changes)
  if (Object.keys(rawChanges).length > 7 || Object.entries(rawChanges).some(([key, value]) => !Object.hasOwn(channelAdminPermissionLabels, key) || typeof value !== 'boolean')) throw new Error(tr('변경할 관리자 권한을 다시 선택해 주세요.'))
  const changes = Object.fromEntries(Object.keys(channelAdminPermissionLabels).filter(key => Object.hasOwn(rawChanges, key)).map(key => [key, rawChanges[key]])) as ChannelAdminPermissionChanges
  return { id: identifier(value.id), requestId: identifier(value.requestId), listRequestId: identifier(value.listRequestId), channelId: identifier(value.channelId), version: value.version,
    title: value.title, userId: identifier(value.userId), adminVersion: value.adminVersion, label: value.label, changes }
}
