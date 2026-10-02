import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { postCreationRequest, type PostCreationContext, type PostCreationRequest } from '../../shared/channel-post-creation'
import { channelPostAuthoring } from '../accounts/channel-post-authoring'
import { database, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { storageBucket } from '../media/media-document'
import { channelPostPhotoPath } from '../../shared/channel-post-photo'
import { grpcCode, grpcDelivery, type WriteDelivery } from './grpc-delivery'
import { tr } from '../../shared/i18n'
export interface PostCreationSource { channel: FirestoreDocument; admin: FirestoreDocument | undefined }
// 'not-sent' goes again when the connection is back; 'unknown' is looked for on the server and goes again under the
// same id if it is not there; 'refused' — the channel or the server said no — ends the post.
export class ChannelPostCreationFailure extends Error {
  // code: the gRPC status behind it, for connection-check.log only.
  constructor(readonly delivery: WriteDelivery, readonly code = '') { super(delivery === 'refused' ? tr('현재 채널 조건이 변경되었거나 서버가 글 게시를 거절했습니다. 최신 정보에서 다시 준비해 주세요.') : tr('글 게시 응답을 확인하지 못했습니다.')) }
  get uncertain(): boolean { return this.delivery === 'unknown' }
}
// ALREADY_EXISTS, FAILED_PRECONDITION and ABORTED are not taken as refusals: an earlier attempt may have created the
// post already, or the commit lost a race. The post is then looked for, and goes again under its id if it is not there.
const refusals = [status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED]
export function postCreationContext(uid: string, channelId: string, source: PostCreationSource): PostCreationContext {
  const info = channelPostAuthoring(uid, channelId, source.channel, source.channel, source.admin), title = source.channel.fields.name?.stringValue
  if (!info || info.permission !== 'allowed' || info.role === 'none' || info.discussion.status === 'unknown' || info.publicChannel === null || typeof title !== 'string' || !title.trim() || title.length > 512) throw new ChannelPostCreationFailure('refused')
  return { authorId: uid, title, channelVersion: info.channelVersion, role: info.role, adminVersion: info.adminVersion, publicChannel: info.publicChannel, discussionId: info.discussion.chatId }
}
export function validatePostCreationSource(uid: string, request: PostCreationRequest, source: PostCreationSource): void {
  const context = postCreationContext(uid, request.channelId, source)
  if (Object.entries(context).some(([key, value]) => request[key as keyof PostCreationRequest] !== value)) throw new ChannelPostCreationFailure('refused')
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostCreation(client: CommitClient, auth: Metadata, uid: string, input: PostCreationRequest, source: PostCreationSource, signal: AbortSignal): Promise<void> {
  const request = postCreationRequest(input)
  if (signal.aborted) throw new ChannelPostCreationFailure('not-sent')
  if (request.authorId !== uid) throw new ChannelPostCreationFailure('refused')
  validatePostCreationSource(uid, request, source)
  const fields: WireObject = Object.fromEntries(Object.entries({ id: request.id, channelId: request.channelId, authorId: uid, text: request.text, visibility: request.visibility, aspectRatio: '4:5' }).map(([key, value]) => [key, { stringValue: value }]))
  fields.likeCount = { integerValue: '0' }; fields.commentCount = { integerValue: '0' }; fields.likedBy = { arrayValue: { values: [] } }; fields.isPinned = { booleanValue: false }
  // ChannelService.createPost: mediaKeys hold gs:// paths in order, mediaTypes the matching kinds.
  if (request.photos.length) {
    fields.mediaKeys = { arrayValue: { values: request.photos.map(photo => ({ stringValue: `gs://${storageBucket}/${channelPostPhotoPath(request.channelId, photo.id)}` })) } }
    fields.mediaTypes = { arrayValue: { values: request.photos.map(() => ({ stringValue: 'image' })) } }
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostCreationFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostCreationFailure('unknown')) }
    const call = client.commit({ database, writes: [
      { update: { name: `${documents}/channels/${request.channelId}/posts/${request.id}`, fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostCreationFailure(grpcDelivery(error, refusals), grpcCode(error))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete post creation commit')
        timestamp(response.commitTime, ''); const result = object(response.writeResults[0]); timestamp(object(result.updateTime), '')
        const transforms = result.transformResults
        if (!Array.isArray(transforms) || transforms.length !== 1) throw new Error('Post timestamp missing')
        timestamp(object(object(transforms[0]).timestampValue), ''); finish()
      } catch { finish(new ChannelPostCreationFailure('unknown')) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
