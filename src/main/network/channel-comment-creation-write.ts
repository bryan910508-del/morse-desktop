import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { commentCreationRequest, type CommentCreationRequest } from '../../shared/channel-comment-creation'
import { database, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { channelPostRevision } from '../media/channel-post-media-document'
import { object } from '../../shared/validation'
import { grpcCode, grpcDelivery, type WriteDelivery } from './grpc-delivery'
import { tr } from '../../shared/i18n'
// As a post (channel-post-creation-write.ts): 'not-sent' goes again, 'unknown' is looked for and goes again under the
// same id if it is not there, 'refused' ends the comment.
export class ChannelCommentCreationFailure extends Error {
  // code: the gRPC status behind it, for connection-check.log only.
  constructor(readonly delivery: WriteDelivery, readonly code = '') { super(delivery === 'refused' ? tr('게시물이나 작성자 정보가 변경되었거나 서버가 등록을 거절했습니다. 최신 정보에서 다시 준비해 주세요.') : tr('댓글 등록 응답을 확인하지 못했습니다.')) }
  get uncertain(): boolean { return this.delivery === 'unknown' }
}
// Q87 / A1: a comment deleted by another device is not written again — the server keeps a deletion record and its
// rules refuse the id (PERMISSION_DENIED, the only refusal a direct write gets). The queue reads that record from the
// server when it finds the comment gone or refused (channel-comment-creation.ts, A1 §3-4).
// ALREADY_EXISTS, FAILED_PRECONDITION and ABORTED are not taken as refusals: an earlier attempt may have created the
// comment already, or the commit lost a race. The comment is then looked for, and goes again under its id if it is not
// there. (Before B373 S2 the commit also raised the post's count, against the post as it was read.)
const refusals = [status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED]
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelCommentCreation(client: CommitClient, auth: Metadata, uid: string, input: CommentCreationRequest, post: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = commentCreationRequest(input), path = `${documents}/channels/${request.channelId}/posts/${request.postId}`
  if (signal.aborted) throw new ChannelCommentCreationFailure('not-sent')
  if (request.authorId !== uid || post.name !== path || !post.updateTime || channelPostRevision(post) !== request.postRevision) throw new ChannelCommentCreationFailure('refused')
  const fields: WireObject = Object.fromEntries(Object.entries({ id: request.id, channelId: request.channelId, postId: request.postId, authorId: uid, authorName: request.authorName, text: request.text }).map(([k, v]) => [k, { stringValue: v }]))
  if (request.parent) { fields.parentCommentId = { stringValue: request.parent.id }; fields.parentAuthorName = { stringValue: request.parentAuthorName } }
  if (request.authorPhotoURL) fields.authorPhotoURL = { stringValue: request.authorPhotoURL }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelCommentCreationFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelCommentCreationFailure('unknown')) }
    const call = client.commit({ database, writes: [
      // B373 S2: the comment only; the server counts the post's comments (rules v4.8.37, recount functions).
      { update: { name: `${path}/comments/${request.id}`, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelCommentCreationFailure(grpcDelivery(error, refusals), grpcCode(error))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete comment creation commit')
        timestamp(response.commitTime, '')
        for (const result of response.writeResults) timestamp(object(object(result).updateTime), '')
        const transforms = object(response.writeResults[0]).transformResults
        if (!Array.isArray(transforms) || transforms.length !== 1) throw new Error('Comment timestamp response missing')
        timestamp(object(object(transforms[0]).timestampValue), ''); finish()
      } catch { finish(new ChannelCommentCreationFailure('unknown')) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
