import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { commentCreationRequest, type CommentCreationRequest } from '../../shared/channel-comment-creation'
import { database, documents, numberField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { channelPostRevision } from '../media/channel-post-media-document'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class ChannelCommentCreationFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('댓글 등록 응답을 확인하지 못했습니다. 이미 등록되었을 수 있어 같은 요청을 다시 보내지 않습니다.') : tr('게시물이나 작성자 정보가 변경되었거나 서버가 등록을 거절했습니다. 최신 정보에서 다시 준비해 주세요.')) }
}
export function commentCreationCount(post: FirestoreDocument): number {
  const raw = post.fields.commentCount, count = numberField(post.fields, 'commentCount')
  const validInteger = typeof raw?.integerValue === 'string' ? /^\d+$/.test(raw.integerValue) : typeof raw?.integerValue === 'number' && Number.isInteger(raw.integerValue)
  const validDouble = raw?.integerValue === undefined && typeof raw?.doubleValue === 'number'
  if ((!validInteger && !validDouble) || !Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) throw new ChannelCommentCreationFailure(false)
  return count
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelCommentCreation(client: CommitClient, auth: Metadata, uid: string, input: CommentCreationRequest, post: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = commentCreationRequest(input), path = `${documents}/channels/${request.channelId}/posts/${request.postId}`
  if (signal.aborted || request.authorId !== uid || post.name !== path || !post.updateTime || channelPostRevision(post) !== request.postRevision || commentCreationCount(post) !== request.count) throw new ChannelCommentCreationFailure(false)
  const fields: WireObject = Object.fromEntries(Object.entries({ id: request.id, channelId: request.channelId, postId: request.postId, authorId: uid, authorName: request.authorName, text: request.text }).map(([k, v]) => [k, { stringValue: v }]))
  if (request.parent) { fields.parentCommentId = { stringValue: request.parent.id }; fields.parentAuthorName = { stringValue: request.parentAuthorName } }
  if (request.authorPhotoURL) fields.authorPhotoURL = { stringValue: request.authorPhotoURL }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelCommentCreationFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelCommentCreationFailure(true)) }
    const call = client.commit({ database, writes: [
      { update: { name: `${path}/comments/${request.id}`, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] },
      { update: { name: path, fields: { commentCount: { integerValue: String(request.count + 1) } } }, updateMask: { fieldPaths: ['commentCount'] }, currentDocument: { updateTime: post.updateTime } }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelCommentCreationFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Incomplete comment creation commit')
        timestamp(response.commitTime, '')
        for (const result of response.writeResults) timestamp(object(object(result).updateTime), '')
        const transforms = object(response.writeResults[0]).transformResults
        if (!Array.isArray(transforms) || transforms.length !== 1) throw new Error('Comment timestamp response missing')
        timestamp(object(object(transforms[0]).timestampValue), ''); finish()
      } catch { finish(new ChannelCommentCreationFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
