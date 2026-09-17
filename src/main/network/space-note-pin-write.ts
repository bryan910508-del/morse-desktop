import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { notePinRequest, type NotePinRequest } from '../../shared/space-note-pin'
import { database, documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class NotePinFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('노트 고정 변경 결과를 확인하지 못했습니다. 같은 요청을 반복하지 말고 현재 노트를 확인해 주세요.') : tr('노트나 노트 고정 상태가 변경되었거나 쓰기 권한을 확인하지 못했습니다. 최신 노트에서 다시 선택해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeSpaceNotePin(client: CommitClient, auth: Metadata, uid: string, input: NotePinRequest, doc: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = notePinRequest(input), path = `${documents}/users/${uid}/spaceNotes/${request.noteId}`
  const pinned = doc.fields.isPinned === undefined ? false : doc.fields.isPinned.booleanValue
  if (signal.aborted || doc.name !== path || !doc.updateTime || documentVersion(doc) !== request.version || pinned !== request.pinned) throw new NotePinFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: NotePinFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new NotePinFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields: { isPinned: { booleanValue: request.desired } } },
      updateMask: { fieldPaths: ['isPinned'] }, currentDocument: { updateTime: doc.updateTime }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new NotePinFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete note pin commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        if (!Array.isArray(result.transformResults) || result.transformResults.length !== 1) throw new Error('Missing note update timestamp')
        timestamp(object(object(result.transformResults[0]).timestampValue), ''); finish()
      } catch { finish(new NotePinFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
