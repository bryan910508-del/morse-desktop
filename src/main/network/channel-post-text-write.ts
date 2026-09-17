import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelPostTextEdit, type ChannelPostTextEdit } from '../../shared/channel-post-text-edit'
import { channelPostRevision } from '../media/channel-post-media-document'
import { database, documents, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export function editablePostText(post: FirestoreDocument): string | null {
  const text = post.fields.text
  return text === undefined ? '' : typeof text.stringValue === 'string' && text.stringValue.length <= 5000 ? text.stringValue : null
}
export class ChannelPostTextFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('게시물 본문 저장 응답을 확인하지 못했습니다. 자동으로 다시 저장하지 않습니다.') : tr('게시물이 변경되었거나 본인 작성·접근 조건을 확인하지 못했습니다. 최신 게시물에서 다시 편집해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostText(client: CommitClient, auth: Metadata, uid: string, input: ChannelPostTextEdit, post: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = channelPostTextEdit(input)
  if (signal.aborted || post.name !== `${documents}/channels/${request.channelId}/posts/${request.postId}` || !post.updateTime || channelPostRevision(post) !== request.revision || stringField(post.fields, 'authorId', 160) !== uid || editablePostText(post) !== request.original) throw new ChannelPostTextFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostTextFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostTextFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: post.name, fields: { text: { stringValue: request.text } } }, updateMask: { fieldPaths: ['text'] }, currentDocument: { updateTime: post.updateTime }, updateTransforms: [{ fieldPath: 'editedAt', setToServerValue: 'REQUEST_TIME' }] }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostTextFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete post text commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        if (!Array.isArray(result.transformResults) || result.transformResults.length !== 1) throw new Error('Post edit time missing')
        timestamp(object(object(result.transformResults[0]).timestampValue), ''); finish()
      } catch { finish(new ChannelPostTextFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
