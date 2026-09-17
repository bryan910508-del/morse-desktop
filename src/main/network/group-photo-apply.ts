import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { groupPhotoVersion } from '../../shared/group-photo-upload'
import { groupPhotoUploadURL } from '../storage/group-photo-upload-table'
import { database, documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class GroupPhotoApplyFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('그룹 사진 적용 결과를 확인하지 못했습니다. 다시 적용하지 않고 현재 그룹 정보를 확인해 주세요.') : tr('그룹 정보가 변경되었거나 사진 변경 권한을 확인하지 못했습니다. 최신 정보에서 다시 편집해 주세요.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
export async function applyGroupPhoto(client: CommitClient, auth: Metadata, edit: { id: string; chatId: string; version: string; url: string }, doc: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = { ...edit, version: groupPhotoVersion(edit.version), url: groupPhotoUploadURL(edit.url, edit.chatId, edit.id) }, path = `${documents}/chats/${request.chatId}`
  if (signal.aborted || doc.name !== path || !doc.updateTime || documentVersion(doc) !== request.version) throw new GroupPhotoApplyFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: GroupPhotoApplyFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new GroupPhotoApplyFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields: { photoURL: { stringValue: request.url }, cachedPhotoURL: { stringValue: request.url } } },
      updateMask: { fieldPaths: ['photoURL', 'cachedPhotoURL'] }, currentDocument: { updateTime: doc.updateTime } }] }, auth,
    { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new GroupPhotoApplyFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid group photo apply commit')
        timestamp(response.commitTime, ''); finish()
      } catch { finish(new GroupPhotoApplyFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
