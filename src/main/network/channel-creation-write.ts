import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelCreationRequest, type ChannelCreationRequest } from '../../shared/channel-creation'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class ChannelCreationFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('채널 생성 응답 미확인') : tr('채널 생성을 시작하지 못했거나 서버가 거절했습니다.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelCreation(client: CommitClient, auth: Metadata, uid: string, input: ChannelCreationRequest, signal: AbortSignal): Promise<void> {
  const request = channelCreationRequest(input)
  if (signal.aborted || request.ownerId !== uid) throw new ChannelCreationFailure(false)
  // Existing iOS defaults: public creation remains locked. Discussion identity is server-owned.
  const fields: WireObject = Object.fromEntries(Object.entries({ id: request.id, name: request.name, description: request.description, ownerId: uid, photoURL: '', coverURL: '', type: 'private', joinPolicy: 'open', chatMode: 'broadcast' }).map(([key, value]) => [key, { stringValue: value }]))
  fields.ownerInfo = { mapValue: { fields: Object.fromEntries(Object.entries(request.ownerInfo).map(([key, value]) => [key, { stringValue: value }])) } }
  fields.isPublic = { booleanValue: false }; fields.discussionHistoryVisible = { booleanValue: true }
  fields.subscriberCount = { integerValue: '0' }; fields.postCount = { integerValue: '0' }
  fields.tags = { arrayValue: { values: [] } }; fields.adminIds = { arrayValue: { values: [] } }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelCreationFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelCreationFailure(true)) }
    const call = client.commit({ database, writes: [
      { update: { name: `${documents}/channels/${request.id}`, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelCreationFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete channel creation commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        if (!Array.isArray(result.transformResults) || result.transformResults.length !== 1) throw new Error('Missing channel timestamp')
        timestamp(object(object(result.transformResults[0]).timestampValue), ''); finish()
      } catch { finish(new ChannelCreationFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
