import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import type { DialogPinRequest } from '../../shared/dialog-pins'
import { identifier } from '../../shared/validation'
import { database, documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class DialogPinWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('고정 저장 결과를 확인하지 못했습니다. 다시 변경하기 전에 고정 상태를 확인해 주세요.')
    : tr('고정 상태가 바뀌었거나 저장 권한을 확인하지 못했습니다. 최신 목록에서 다시 선택해 주세요.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
export async function writeDialogPin(client: CommitClient, auth: Metadata, uid: string, request: DialogPinRequest, rank: number,
  doc: FirestoreDocument | undefined, signal: AbortSignal): Promise<void> {
  const path = `${documents}/users/${identifier(uid)}/dialogStates/${identifier(request.chatId)}`
  identifier(request.id)
  if (!Number.isFinite(rank) || rank < 0 || rank > 1e12 ||
    (doc ? doc.name !== path || !doc.updateTime || documentVersion(doc) !== request.version : request.version !== '')) throw new DialogPinWriteFailure(false)
  if (signal.aborted) throw new DialogPinWriteFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: DialogPinWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new DialogPinWriteFailure(true)) }
    const call = client.commit({ database, writes: [{
      update: { name: path, fields: { isPinned: { booleanValue: request.pinned }, rank: { doubleValue: rank }, operationId: { stringValue: request.id } } },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: doc ? { updateTime: doc.updateTime } : { exists: false }
    }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new DialogPinWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid pin commit')
        timestamp(response.commitTime, ''); finish()
      } catch { finish(new DialogPinWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
