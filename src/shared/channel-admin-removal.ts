import { channelAdminPermissionsEdit, type ChannelAdminPermissionsEdit } from './channel-admin-permissions'
import { object } from './validation'
import { tr } from './i18n'
export type ChannelAdminRemoval = Omit<ChannelAdminPermissionsEdit, 'changes'>
export interface ChannelAdminRemovalResult { outcome: 'saved' | 'rejected' | 'uncertain'; message: string }
export function channelAdminRemoval(raw: unknown): ChannelAdminRemoval {
  const value = object(raw)
  if (Object.hasOwn(value, 'changes')) throw new Error(tr('해제할 관리자를 다시 선택해 주세요.'))
  const { changes: _changes, ...request } = channelAdminPermissionsEdit({ ...value, changes: {} })
  return request
}
