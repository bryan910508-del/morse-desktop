import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelAdminPermissionsEdit, type ChannelAdminPermissionsEdit } from '../../shared/channel-admin-permissions'
import { channelAdminIndex } from '../accounts/channel-admin-values'
import { object } from '../../shared/validation'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelAdminPermissionsWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('권한 저장 결과를 확인하지 못했습니다. 다시 저장하지 않고 현재 관리자 정보를 확인해 주세요.') : tr('채널·관리자 정보가 변경되었거나 권한을 확인하지 못했습니다. 최신 목록에서 다시 편집해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelAdminPermissions(client: CommitClient, auth: Metadata, uid: string, edit: ChannelAdminPermissionsEdit, channel: FirestoreDocument, admin: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = channelAdminPermissionsEdit(edit), path = `${documents}/channels/${request.channelId}`, keys = Object.keys(request.changes)
  if (signal.aborted || !keys.length || channel.name !== path || !channel.updateTime || documentVersion(channel) !== request.version || stringField(channel.fields, 'ownerId', 160) !== uid || request.userId === uid ||
    admin.name !== `${path}/admins/${request.userId}` || !admin.updateTime || documentVersion(admin) !== request.adminVersion) throw new ChannelAdminPermissionsWriteFailure(false)
  const index = channelAdminIndex(channel)
  if (!index.ids || (!index.ids.has(request.userId) && index.ids.size >= 1000)) throw new ChannelAdminPermissionsWriteFailure(false)
  // A scalar permissions value cannot be partially updated without replacing its structure.
  if (admin.fields.permissions !== undefined) {
    try { const map = object(object(admin.fields.permissions).mapValue); if (map.fields !== undefined) object(map.fields) }
    catch { throw new ChannelAdminPermissionsWriteFailure(false) }
  }
  const ids = [...index.ids]; if (!index.ids.has(request.userId)) ids.push(request.userId)
  const fields = Object.fromEntries(Object.entries(request.changes).map(([key, value]) => [key, { booleanValue: value }]))
  const writes = [
    { update: { name: admin.name, fields: { permissions: { mapValue: { fields } } } }, updateMask: { fieldPaths: keys.map(key => `permissions.${key}`) }, currentDocument: { updateTime: admin.updateTime } },
    { update: { name: channel.name, fields: { adminIds: { arrayValue: { values: ids.map(id => ({ stringValue: id })) } } } }, updateMask: { fieldPaths: ['adminIds'] }, currentDocument: { updateTime: channel.updateTime } }
  ]
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelAdminPermissionsWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new ChannelAdminPermissionsWriteFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new ChannelAdminPermissionsWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Invalid admin commit')
        timestamp(response.commitTime, '')
        for (const result of response.writeResults) { const value = object(result); if (!value.updateTime) throw new Error('Missing update time'); timestamp(value.updateTime, '') }
        finish()
      } catch { finish(new ChannelAdminPermissionsWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
