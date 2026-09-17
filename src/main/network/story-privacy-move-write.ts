import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { storyPrivacyMoveRequest, type StoryPrivacyMoveRequest } from '../../shared/story-privacy-move'
import { positionMilliseconds } from '../../shared/model'
import { database, documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from './own-story-document'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class StoryPrivacyMoveFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('스토리 공개 범위 변경 응답 미확인') : tr('공개 범위 변경을 시작하지 못했거나 서버가 거절했습니다.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeStoryPrivacyMove(client: CommitClient, auth: Metadata, uid: string, input: StoryPrivacyMoveRequest, source: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = storyPrivacyMoveRequest(input), path = `${documents}/users/${uid}/${ownStoryCollections[request.privacy]}/${request.storyId}`, destination = `${documents}/users/${uid}/${ownStoryCollections[request.desired]}/${request.storyId}`
  try {
    const current = ownStoryFromDocument(source, uid, request.privacy)
    if (signal.aborted || request.ownerId !== uid || source.name !== path || documentVersion(source) !== request.version || !source.updateTime || current.caption !== request.caption || current.mediaType !== request.mediaType || positionMilliseconds(current.expires) !== request.expiresAt || request.expiresAt <= Date.now()) throw new Error('Current story changed or expired')
  } catch { throw new StoryPrivacyMoveFailure(false) }
  // Copy current server fields in main only; change privacy without resetting viewer maps.
  const fields = { ...source.fields, privacy: { stringValue: request.desired } }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: StoryPrivacyMoveFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new StoryPrivacyMoveFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: destination, fields }, currentDocument: { exists: false } }, { delete: path, currentDocument: { updateTime: source.updateTime } }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new StoryPrivacyMoveFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Incomplete privacy move commit')
        timestamp(response.commitTime, ''); timestamp(object(object(response.writeResults[0]).updateTime), ''); object(response.writeResults[1]); finish()
      } catch { finish(new StoryPrivacyMoveFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
