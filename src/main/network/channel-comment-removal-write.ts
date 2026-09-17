import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelCommentRemoval, type ChannelCommentRemoval } from '../../shared/channel-comment-removal'
import { database, documents, numberField, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { channelPostRevision } from '../media/channel-post-media-document'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export interface CommentRemovalSource { post: FirestoreDocument; comment: FirestoreDocument | null }
export class ChannelCommentRemovalFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('댓글 삭제 결과를 확인하지 못했습니다. 삭제를 반복하지 않고 현재 목록을 확인해 주세요.') : tr('댓글·게시물·집계가 변경되었거나 삭제 권한을 확인하지 못했습니다. 최신 내 댓글에서 다시 선택해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelCommentRemoval(client: CommitClient, auth: Metadata, uid: string, input: ChannelCommentRemoval, source: CommentRemovalSource, signal: AbortSignal): Promise<void> {
  const request = channelCommentRemoval(input), { post, comment } = source, path = `${documents}/channels/${request.channelId}/posts/${request.postId}`
  const counter = post.fields.commentCount
  if (signal.aborted || post.name !== path || !post.updateTime || channelPostRevision(post) !== request.revision || !counter || (counter.integerValue === undefined && counter.doubleValue === undefined) || numberField(post.fields, 'commentCount') !== request.count ||
    !comment || comment.name !== `${path}/comments/${request.commentId}` || !comment.updateTime || channelPostRevision(comment) !== request.commentRevision || stringField(comment.fields, 'authorId', 160) !== uid || comment.fields.text?.stringValue !== request.text || stringField(comment.fields, 'channelId', 160) !== request.channelId || stringField(comment.fields, 'postId', 160) !== request.postId) throw new ChannelCommentRemovalFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelCommentRemovalFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelCommentRemovalFailure(true)) }
    const call = client.commit({ database, writes: [
      { delete: comment.name, currentDocument: { updateTime: comment.updateTime } },
      { update: { name: post.name, fields: { commentCount: { integerValue: String(request.count - 1) } } }, updateMask: { fieldPaths: ['commentCount'] }, currentDocument: { updateTime: post.updateTime } }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelCommentRemovalFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Incomplete comment removal commit')
        timestamp(response.commitTime, ''); object(response.writeResults[0]); timestamp(object(object(response.writeResults[1]).updateTime), ''); finish()
      } catch { finish(new ChannelCommentRemovalFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
