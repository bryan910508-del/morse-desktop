import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { postVisibilityRequest, type PostVisibilityRequest } from '../../shared/channel-post-visibility'
import { channelPostRevision } from '../media/channel-post-media-document'
import { editablePostText } from './channel-post-text-write'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export interface PostVisibilitySource { channel: FirestoreDocument; post: FirestoreDocument }
export class ChannelPostVisibilityFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('공개 범위 저장 응답을 확인하지 못했습니다. 같은 요청을 자동 반복하지 않습니다.') : tr('게시물·채널 공개 설정 또는 권한이 변경되었습니다. 최신 정보에서 다시 검토해 주세요.')) }
}
export function validatePostVisibility(uid: string, request: PostVisibilityRequest, source: PostVisibilitySource): void {
  const { channel, post } = source
  if (channel.name !== `${documents}/channels/${request.channelId}` || !channel.updateTime || documentVersion(channel) !== request.channelVersion || stringField(channel.fields, 'ownerId', 160) !== uid || channel.fields.isPublic?.booleanValue !== request.publicChannel ||
    post.name !== `${channel.name}/posts/${request.postId}` || !post.updateTime || channelPostRevision(post) !== request.revision || stringField(post.fields, 'channelId', 160) !== request.channelId || stringField(post.fields, 'authorId', 160) !== uid || post.fields.visibility?.stringValue !== request.previous || editablePostText(post) === null) throw new ChannelPostVisibilityFailure(false)
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostVisibility(client: CommitClient, auth: Metadata, uid: string, input: PostVisibilityRequest, source: PostVisibilitySource, signal: AbortSignal): Promise<void> {
  const request = postVisibilityRequest(input)
  if (signal.aborted) throw new ChannelPostVisibilityFailure(false)
  validatePostVisibility(uid, request, source)
  const { channel, post } = source
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostVisibilityFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostVisibilityFailure(true)) }
    const call = client.commit({ database, writes: [
      { update: { name: post.name, fields: { visibility: { stringValue: request.next } } }, updateMask: { fieldPaths: ['visibility'] }, updateTransforms: [{ fieldPath: 'editedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { updateTime: post.updateTime } },
      { update: { name: channel.name, fields: { isPublic: channel.fields.isPublic } }, updateMask: { fieldPaths: ['isPublic'] }, currentDocument: { updateTime: channel.updateTime } }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostVisibilityFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Incomplete visibility commit')
        timestamp(response.commitTime, ''); for (const result of response.writeResults) timestamp(object(object(result).updateTime), '')
        const transforms = object(response.writeResults[0]).transformResults
        if (!Array.isArray(transforms) || transforms.length !== 1) throw new Error('Visibility edit timestamp missing')
        timestamp(object(object(transforms[0]).timestampValue), ''); finish()
      } catch { finish(new ChannelPostVisibilityFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
