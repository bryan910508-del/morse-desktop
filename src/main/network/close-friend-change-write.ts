import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { closeFriendChangeRequest, type CloseFriendChangeRequest } from '../../shared/close-friend-change'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class CloseFriendChangeFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('친한 친구 변경 응답 미확인') : tr('친한 친구 변경을 시작하지 못했거나 서버가 거절했습니다.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeCloseFriendChange(client: CommitClient, auth: Metadata, uid: string, input: CloseFriendChangeRequest, signal: AbortSignal): Promise<void> {
  const request = closeFriendChangeRequest(input), path = `${documents}/users/${uid}/closeFriends/${request.peerUid}`
  if (signal.aborted || request.ownerId !== uid) throw new CloseFriendChangeFailure(false)
  let write: WireObject
  if (request.mode === 'add') write = { update: { name: path, fields: {} }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }
  else {
    const [seconds, nanos] = request.version!.split(':'), updateTime = { seconds, nanos: Number(nanos) }
    try { const at = timestamp(updateTime, ''); if (`${at.seconds}:${at.nanoseconds}` !== request.version || at.nanoseconds % 1000 !== 0) throw new Error('Unsupported membership timestamp') }
    catch { throw new CloseFriendChangeFailure(false) }
    write = { delete: path, currentDocument: { updateTime } }
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: CloseFriendChangeFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new CloseFriendChangeFailure(true)) }
    const call = client.commit({ database, writes: [write] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new CloseFriendChangeFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete close friend change commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0])
        if (request.mode === 'add') {
          timestamp(object(result.updateTime), '')
          if (!Array.isArray(result.transformResults) || result.transformResults.length !== 1) throw new Error('Missing creation timestamp')
          timestamp(object(object(result.transformResults[0]).timestampValue), '')
        }
        finish()
      } catch { finish(new CloseFriendChangeFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
