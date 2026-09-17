import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelAdminAppointment, type ChannelAdminAppointment } from '../../shared/channel-admin-appointment'
import { channelAdminIndex } from '../accounts/channel-admin-values'
import { object } from '../../shared/validation'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelAdminAppointmentWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('관리자 지정 결과를 확인하지 못했습니다. 다시 요청하지 않고 현재 관리자 목록을 확인해 주세요.') : tr('채널·구독자·관리자 정보가 변경되었거나 지정 권한을 확인하지 못했습니다. 최신 목록에서 다시 선택해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelAdminAppointment(client: CommitClient, auth: Metadata, uid: string, edit: ChannelAdminAppointment, channel: FirestoreDocument, subscriber: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = channelAdminAppointment(edit), path = `${documents}/channels/${request.channelId}`
  if (signal.aborted || channel.name !== path || !channel.updateTime || documentVersion(channel) !== request.version || stringField(channel.fields, 'ownerId', 160) !== uid || request.userId === uid ||
    subscriber.name !== `${path}/subscribers/${request.userId}` || !subscriber.updateTime || documentVersion(subscriber) !== request.subscriberVersion ||
    (subscriber.fields.uid !== undefined && stringField(subscriber.fields, 'uid', 160) !== request.userId) || stringField(subscriber.fields, 'displayName', 512).trim() !== request.label) throw new ChannelAdminAppointmentWriteFailure(false)
  const index = channelAdminIndex(channel)
  if (!index.ids || (!index.ids.has(request.userId) && index.ids.size >= 1000)) throw new ChannelAdminAppointmentWriteFailure(false)
  let photo = ''
  if (subscriber.fields.photoURL !== undefined) {
    const raw = subscriber.fields.photoURL.stringValue
    if (typeof raw !== 'string' || raw.length > 4096) throw new ChannelAdminAppointmentWriteFailure(false)
    photo = raw
  }
  const ids = [...index.ids]; if (!index.ids.has(request.userId)) ids.push(request.userId)
  const fields = Object.fromEntries(Object.entries(request.permissions).map(([key, value]) => [key, { booleanValue: value }]))
  const writes = [
    { update: { name: `${path}/admins/${request.userId}`, fields: { displayName: { stringValue: request.label }, photoURL: { stringValue: photo }, permissions: { mapValue: { fields } }, appointedBy: { stringValue: uid } } },
      updateTransforms: [{ fieldPath: 'appointedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } },
    { update: { name: channel.name, fields: { adminIds: { arrayValue: { values: ids.map(id => ({ stringValue: id })) } } } }, updateMask: { fieldPaths: ['adminIds'] }, currentDocument: { updateTime: channel.updateTime } }
  ]
  // The subscriber is a preflight observation, not a new write or transaction guard.
  // Existing server policy grants admin status independently of later subscription changes.
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelAdminAppointmentWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new ChannelAdminAppointmentWriteFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new ChannelAdminAppointmentWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Invalid admin appointment commit')
        timestamp(response.commitTime, '')
        for (const result of response.writeResults) { const value = object(result); if (!value.updateTime) throw new Error('Missing update time'); timestamp(value.updateTime, '') }
        const transforms = object(response.writeResults[0]).transformResults
        if (!Array.isArray(transforms) || transforms.length !== 1 || !object(transforms[0]).timestampValue) throw new Error('Missing appointment time')
        timestamp(object(transforms[0]).timestampValue, '')
        finish()
      } catch { finish(new ChannelAdminAppointmentWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
