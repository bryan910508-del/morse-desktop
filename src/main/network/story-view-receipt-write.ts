import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { object } from '../../shared/validation'
import { storyViewReceiptRequest, type StoryViewReceiptRequest } from '../../shared/story-view-receipt'
import { positionMilliseconds } from '../../shared/model'
import { database, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from './own-story-document'
import { storyHiddenFrom } from './story-hidden-audience'
import { currentViewerRecord } from './contact-story-view-record'
import { recordStoryStep } from '../platform/story-diagnostics'
import { tr } from '../../shared/i18n'
export class StoryViewReceiptWriteFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('열람 기록 결과 미확인') : tr('열람 기록을 시작하지 못했거나 서버가 거절했습니다.')) } }
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.ABORTED, status.ALREADY_EXISTS, status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])
// iOS records a view with one write (StoryService.markViewed: updateData(["viewerIds":
// FieldValue.arrayUnion([uid]), "viewedAtByUid.<uid>": FieldValue.serverTimestamp()])), which is the
// shape firestore.rules storyViewerMutation allows, and Telegram marks a story read with a single
// request of its own (Data::Stories::sendMarkAsReadRequests). This began as a transaction, so that
// the story could be re-read under a lock before the receipt landed; a transaction's own reads are
// refused from here, the way a reaction's were (story-reaction-write.ts), and story-check.log carried
// `receipt-start-failed grpc-7` from every run that opened someone's story — no view this desktop
// made was ever recorded. The story is read plainly before this call instead, and the commit no
// longer names the version it read: another viewer's receipt landing first moves the story on, and
// that is not a conflict for one appended id and one map key of this viewer's own.
export async function writeStoryViewReceipt(client: CommitClient, auth: Metadata, uid: string, input: StoryViewReceiptRequest, story: FirestoreDocument, signal: AbortSignal, validate: () => void): Promise<void> {
  const request = storyViewReceiptRequest(input)
  const storyPath = `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`
  let committing = false
  try {
    signal.throwIfAborted(); validate()
    if (request.viewerId !== uid || request.ownerId === uid) throw new Error('Viewer identity mismatch')
    if (story.name !== storyPath) throw new Error('Story lookup scope mismatch')
    const current = ownStoryFromDocument(story, request.ownerId, request.privacy)
    if (current.version !== request.version || positionMilliseconds(current.expires) !== request.expiresAt || request.expiresAt <= Date.now()) throw new Error('Story expired or replaced')
    if (storyHiddenFrom(story).hiddenFrom.includes(uid)) throw new Error('Story hidden from this viewer')
    const prior = currentViewerRecord(story, uid, true)
    if (prior.listed || prior.viewerFieldPresent !== request.viewerFieldPresent || prior.timeField !== request.originalTimeField || prior.viewedAt !== request.originalViewedAt) throw new Error('Original view record changed')
    // A quoted single UID segment cannot address another map entry.
    const ownTimeField = `viewedAtByUid.\`${uid}\``
    signal.throwIfAborted(); validate()
    committing = true
    const result = await new Promise<WireObject>((done, reject) => {
      let settled = false
      const finish = (error: unknown, response?: WireObject): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else done(response!)
      }
      const cancel = (): void => { call.cancel(); finish(new Error('View receipt operation cancelled')) }
      // The transforms touch this viewer's own id and own map key, and never create the story.
      const call = client.commit({ database, writes: [{ transform: { document: storyPath, fieldTransforms: [
        { fieldPath: 'viewerIds', appendMissingElements: { values: [{ stringValue: uid }] } },
        { fieldPath: ownTimeField, setToServerValue: 'REQUEST_TIME' }
      ] }, currentDocument: { exists: true } }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => finish(error, response))
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
    if (!Array.isArray(result.writeResults) || result.writeResults.length !== 1 || !result.commitTime) throw new Error('Incomplete view receipt commit')
    timestamp(result.commitTime, ''); const written = object(result.writeResults[0]); timestamp(object(written.updateTime), '')
    if (!Array.isArray(written.transformResults) || written.transformResults.length !== 2 || object(written.transformResults[0]).nullValue !== 'NULL_VALUE') throw new Error('Incomplete view receipt transforms')
    timestamp(object(written.transformResults[1]).timestampValue, uid)
  } catch (error) {
    if (error instanceof StoryViewReceiptWriteFailure) throw error
    const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
    // A receipt is written without telling the viewer, so its refusals are only ever seen here.
    recordStoryStep(committing ? 'receipt-commit-failed' : 'receipt-check-failed', `grpc-${code ?? 0} ${error instanceof Error ? error.message : ''}`)
    throw new StoryViewReceiptWriteFailure(committing && (code === undefined || !definite.has(code)))
  }
}
