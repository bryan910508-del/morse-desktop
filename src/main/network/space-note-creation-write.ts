import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { noteCreationRequest, type NoteCreationRequest } from '../../shared/space-note-creation'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class NoteCreationFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('노트 생성 응답 미확인') : tr('노트 생성을 시작하지 못했거나 서버가 거절했습니다.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeNoteCreation(client: CommitClient, auth: Metadata, uid: string, input: NoteCreationRequest, signal: AbortSignal): Promise<void> {
  const request = noteCreationRequest(input)
  if (signal.aborted || request.ownerId !== uid) throw new NoteCreationFailure(false)
  // Keep the existing own spaceNotes fields; local request/draft metadata never goes on wire.
  const fields: WireObject = { title: { stringValue: request.title }, body: { stringValue: request.body }, isPinned: { booleanValue: request.pinned } }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: NoteCreationFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new NoteCreationFailure(true)) }
    const call = client.commit({ database, writes: [
      { update: { name: `${documents}/users/${uid}/spaceNotes/${request.id}`, fields }, currentDocument: { exists: false }, updateTransforms: ['createdAt', 'updatedAt'].map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new NoteCreationFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete note creation commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        if (!Array.isArray(result.transformResults) || result.transformResults.length !== 2) throw new Error('Missing note timestamps')
        for (const transform of result.transformResults) timestamp(object(object(transform).timestampValue), '')
        finish()
      } catch { finish(new NoteCreationFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
