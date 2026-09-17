import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { storyHiddenChangeRequest, type StoryHiddenChangeRequest } from '../../shared/story-hidden-change'
import { positionMilliseconds } from '../../shared/model'
import { database, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from './own-story-document'
import { storyHiddenFrom } from './story-hidden-audience'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class StoryHiddenChangeFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('스토리 숨김 변경 응답 미확인') : tr('숨김 변경을 시작하지 못했거나 서버가 거절했습니다.')) } }
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeStoryHiddenChange(client: CommitClient, auth: Metadata, uid: string, input: StoryHiddenChangeRequest, source: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = storyHiddenChangeRequest(input), path = `${documents}/users/${uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`
  try {
    const current = ownStoryFromDocument(source, uid, request.privacy)
    if (signal.aborted || request.ownerId !== uid || source.name !== path || current.version !== request.version || !source.updateTime || current.caption !== request.caption || positionMilliseconds(current.expires) !== request.expiresAt || request.expiresAt <= Date.now() || JSON.stringify(storyHiddenFrom(source).hiddenFrom) !== JSON.stringify(request.original)) throw new Error('Current story changed or expired')
  } catch { throw new StoryHiddenChangeFailure(false) }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: StoryHiddenChangeFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new StoryHiddenChangeFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields: { hiddenFrom: { arrayValue: { values: request.desired.map(uid => ({ stringValue: uid })) } } } }, updateMask: { fieldPaths: ['hiddenFrom'] }, currentDocument: { updateTime: source.updateTime } }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new StoryHiddenChangeFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete hidden audience commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        if (result.transformResults !== undefined && (!Array.isArray(result.transformResults) || result.transformResults.length !== 0)) throw new Error('Unexpected hidden audience transform')
        finish()
      } catch { finish(new StoryHiddenChangeFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
