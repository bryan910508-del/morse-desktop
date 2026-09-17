import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { groupPhotoClear, type GroupPhotoClear } from '../../shared/group-photo'
import { database, documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class GroupPhotoWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('그룹 사진 해제 결과를 확인하지 못했습니다. 다시 해제하지 않고 현재 그룹 정보를 확인해 주세요.') : tr('그룹 정보가 변경되었거나 사진 변경 권한을 확인하지 못했습니다. 최신 정보에서 다시 편집해 주세요.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
export async function clearGroupPhoto(client: CommitClient, auth: Metadata, edit: GroupPhotoClear, doc: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = groupPhotoClear(edit), path = `${documents}/chats/${request.chatId}`
  if (signal.aborted || doc.name !== path || !doc.updateTime || documentVersion(doc) !== request.version) throw new GroupPhotoWriteFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: GroupPhotoWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new GroupPhotoWriteFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields: {} },
      updateMask: { fieldPaths: ['photoURL', 'cachedPhotoURL'] }, currentDocument: { updateTime: doc.updateTime } }] }, auth,
    { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new GroupPhotoWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid group photo clear commit')
        timestamp(response.commitTime, ''); finish()
      } catch { finish(new GroupPhotoWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
