import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { storyPublicationCommitRequest, type StoryPublicationCommitRequest } from '../../shared/story-publication-commit'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { ownStoryCollections } from './own-story-document'
import { storyPhotoPath } from '../media/story-photo-upload-record'
import { storageBucket } from '../media/media-document'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class StoryPublicationFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('스토리 게시 응답 미확인') : tr('스토리 게시를 시작하지 못했거나 서버가 거절했습니다.')) } }
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeStoryPublication(client: CommitClient, auth: Metadata, uid: string, input: StoryPublicationCommitRequest, signal: AbortSignal): Promise<void> {
  let request: StoryPublicationCommitRequest
  try { request = storyPublicationCommitRequest(input); if (signal.aborted || request.intent.ownerId !== uid || request.time.expiresAt <= Date.now() || request.time.createdAt > Date.now() + 60000) throw new Error('Invalid story publication scope or time') }
  catch { throw new StoryPublicationFailure(false) }
  const { intent, time } = request, str = (value: string): WireObject => ({ stringValue: value }), at = (value: number): WireObject => ({ timestampValue: { seconds: String(Math.floor(value / 1000)), nanos: value % 1000 * 1000000 } })
  const fields: WireObject = { ownerType: str('user'), ownerId: str(uid), authorId: str(uid), mediaType: str('image'), mediaURL: str(`gs://${storageBucket}/${storyPhotoPath(uid, intent.id, 'full')}`), thumbnailURL: str(`gs://${storageBucket}/${storyPhotoPath(uid, intent.id, 'thumbnail')}`), caption: str(intent.caption), privacy: str(intent.privacy), createdAt: at(time.createdAt), expiresAt: at(time.expiresAt), hiddenFrom: { arrayValue: { values: intent.hiddenFrom.map(str) } }, viewerIds: { arrayValue: { values: [] } }, reactionByUid: { mapValue: { fields: {} } }, viewedAtByUid: { mapValue: { fields: {} } }, repostByUid: { mapValue: { fields: {} } }, forwardByUid: { mapValue: { fields: {} } } }
  if(intent.audio)fields.audioURL=str(`gs://${storageBucket}/${storyPhotoPath(uid,intent.id,'audio')}`)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: StoryPublicationFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new StoryPublicationFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: `${documents}/users/${uid}/${ownStoryCollections[intent.privacy]}/${intent.id}`, fields }, currentDocument: { exists: false } }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new StoryPublicationFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete story publication acknowledgement')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        if (result.transformResults !== undefined && (!Array.isArray(result.transformResults) || result.transformResults.length)) throw new Error('Unexpected story publication transform')
        finish()
      } catch { finish(new StoryPublicationFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
