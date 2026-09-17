import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { noteTextSaveRequest, type NoteTextSaveRequest } from '../../shared/space-note-text-save'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class NoteTextSaveFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('노트 수정 결과를 확인하지 못했습니다. 같은 요청을 반복하지 말고 현재 노트를 확인해 주세요.') : tr('노트가 변경되었거나 쓰기 권한을 확인하지 못했습니다. 최신 노트에서 다시 선택해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeNoteTextSave(client: CommitClient, auth: Metadata, uid: string, input: NoteTextSaveRequest, signal: AbortSignal): Promise<void> {
  const request = noteTextSaveRequest(input), path = `${documents}/users/${uid}/spaceNotes/${request.noteId}`
  const [seconds, nanos] = request.draft.baseVersion.split(':')
  const updateTime = { seconds, nanos: Number(nanos) }
  try {
    const at = timestamp(updateTime, '')
    if (signal.aborted || request.ownerId !== uid || `${at.seconds}:${at.nanoseconds}` !== request.draft.baseVersion || at.nanoseconds % 1000 !== 0) throw new Error('Unsupported base timestamp')
  } catch { throw new NoteTextSaveFailure(false) }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: NoteTextSaveFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new NoteTextSaveFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields: { title: { stringValue: request.draft.title }, body: { stringValue: request.draft.body } } },
      updateMask: { fieldPaths: ['title', 'body'] }, currentDocument: { updateTime }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new NoteTextSaveFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete note text commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        if (!Array.isArray(result.transformResults) || result.transformResults.length !== 1) throw new Error('Missing note update timestamp')
        timestamp(object(object(result.transformResults[0]).timestampValue), ''); finish()
      } catch { finish(new NoteTextSaveFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
