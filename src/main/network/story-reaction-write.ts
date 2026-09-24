import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { object } from '../../shared/validation'
import { storyReactionChangeRequest, type StoryReactionChangeRequest } from '../../shared/story-reaction-change'
import { positionMilliseconds } from '../../shared/model'
import { database, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from './own-story-document'
import { storyHiddenFrom } from './story-hidden-audience'
import { currentViewerReaction } from './contact-story-reaction'
import { recordStoryStep } from '../platform/story-diagnostics'
import { tr } from '../../shared/i18n'
export class StoryReactionWriteFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('반응 변경 결과 미확인') : tr('반응 변경을 시작하지 못했거나 서버가 거절했습니다.')) } }
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.ABORTED, status.ALREADY_EXISTS, status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])
// iOS sets a reaction with one write of its own map key (StoryService.setReaction:
// updateData(["reactionByUid.<uid>": emoji]) or FieldValue.delete()), which is what the rule
// storyReactionOwnKeyOnly allows. The story read that proves what is being replaced happens
// before this call, outside a transaction: a transaction's reads are refused from here, and
// another viewer's receipt landing first is not a conflict for a single map key.
export async function writeStoryReaction(client: CommitClient, auth: Metadata, uid: string, input: StoryReactionChangeRequest, story: FirestoreDocument, signal: AbortSignal, validate: () => void): Promise<void> {
  const request = storyReactionChangeRequest(input)
  const storyPath = `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`
  let committing = false
  try {
    signal.throwIfAborted(); validate()
    if (request.viewerId !== uid || request.ownerId === uid) throw new Error('Viewer identity mismatch')
    if (story.name !== storyPath) throw new Error('Story lookup scope mismatch')
    const current = ownStoryFromDocument(story, request.ownerId, request.privacy)
    if (positionMilliseconds(current.expires) !== request.expiresAt || request.expiresAt <= Date.now()) throw new Error('Story expired or replaced')
    if (storyHiddenFrom(story).hiddenFrom.includes(uid)) throw new Error('Story hidden from this viewer')
    if (currentViewerReaction(story, uid, request.desired !== null).value !== request.original) throw new Error('Original reaction changed')
    // A quoted single UID segment cannot address another map entry.
    const ownField = `reactionByUid.\`${uid}\``
    const fields: WireObject = request.desired === null ? {} : { reactionByUid: { mapValue: { fields: { [uid]: { stringValue: request.desired } } } } }
    signal.throwIfAborted(); validate()
    committing = true
    const result = await new Promise<WireObject>((done, reject) => {
      let settled = false
      const finish = (error: unknown, response?: WireObject): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else done(response!)
      }
      const cancel = (): void => { call.cancel(); finish(new Error('Reaction operation cancelled')) }
      // An update whose mask names one key changes only that key, and never creates the story.
      const call = client.commit({ database, writes: [{ update: { name: storyPath, fields }, updateMask: { fieldPaths: [ownField] }, currentDocument: { exists: true } }] },
        auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => finish(error, response))
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
    if (!Array.isArray(result.writeResults) || result.writeResults.length !== 1 || !result.commitTime) throw new Error('Incomplete reaction commit')
    timestamp(result.commitTime, ''); const written = object(result.writeResults[0]); timestamp(object(written.updateTime), '')
    if (written.transformResults !== undefined && (!Array.isArray(written.transformResults) || written.transformResults.length)) throw new Error('Unexpected reaction transform')
  } catch (error) {
    if (error instanceof StoryReactionWriteFailure) throw error
    const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
    recordStoryStep(committing ? 'reaction-commit-failed' : 'reaction-check-failed', `grpc-${code ?? 0} ${error instanceof Error ? error.message : ''}`)
    throw new StoryReactionWriteFailure(committing && (code === undefined || !definite.has(code)))
  }
}
