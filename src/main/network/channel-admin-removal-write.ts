import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelAdminRemoval, type ChannelAdminRemoval } from '../../shared/channel-admin-removal'
import { channelAdminIndex } from '../accounts/channel-admin-values'
import { object } from '../../shared/validation'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelAdminRemovalWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('관리자 해제 결과를 확인하지 못했습니다. 다시 요청하지 않고 현재 관리자 목록을 확인해 주세요.') : tr('채널·관리자 정보가 변경되었거나 해제 권한을 확인하지 못했습니다. 최신 목록에서 다시 선택해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelAdminRemoval(client: CommitClient, auth: Metadata, uid: string, edit: ChannelAdminRemoval, channel: FirestoreDocument, admin: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = channelAdminRemoval(edit), path = `${documents}/channels/${request.channelId}`
  if (signal.aborted || channel.name !== path || !channel.updateTime || documentVersion(channel) !== request.version || stringField(channel.fields, 'ownerId', 160) !== uid || request.userId === uid ||
    admin.name !== `${path}/admins/${request.userId}` || !admin.updateTime || documentVersion(admin) !== request.adminVersion) throw new ChannelAdminRemovalWriteFailure(false)
  const index = channelAdminIndex(channel)
  if (!index.ids) throw new ChannelAdminRemovalWriteFailure(false)
  const ids = [...index.ids].filter(id => id !== request.userId)
  const writes = [
    { delete: admin.name, currentDocument: { updateTime: admin.updateTime } },
    { update: { name: channel.name, fields: { adminIds: { arrayValue: { values: ids.map(id => ({ stringValue: id })) } } } }, updateMask: { fieldPaths: ['adminIds'] }, currentDocument: { updateTime: channel.updateTime } }
  ]
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelAdminRemovalWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new ChannelAdminRemovalWriteFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new ChannelAdminRemovalWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Invalid admin removal commit')
        timestamp(response.commitTime, '')
        // Firestore deletion results do not require an updateTime; the root update does.
        object(response.writeResults[0])
        const root = object(response.writeResults[1]); if (!root.updateTime) throw new Error('Missing root update time'); timestamp(root.updateTime, '')
        finish()
      } catch { finish(new ChannelAdminRemovalWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
