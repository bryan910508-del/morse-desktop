import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { postRemovalTarget, type PostRemovalTarget } from '../../shared/channel-post-removal'
import { channelPostRevision } from '../media/channel-post-media-document'
import { channelPinReference } from '../accounts/channel-post-pins'
import { channelDiscussionReference } from '../accounts/channel-discussion-reference'
import { channelDeleteRole, type ChannelDeleteRole } from '../accounts/channel-delete-authority'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
// admin: this account's channels/{id}/admins/{uid} document when it is not the owner (A1 §3-5), undefined when none.
export interface PostRemovalSource { channel: FirestoreDocument; post: FirestoreDocument | null; admin?: FirestoreDocument }
export class ChannelPostRemovalFailure extends Error {
  // code: the gRPC status the server answered with (0 when none), so a queue can tell a race from a refusal.
  constructor(readonly uncertain: boolean, readonly code = 0) { super(uncertain ? tr('게시물 삭제 응답을 확인하지 못했습니다. 이미 반영되었을 수 있어 같은 요청을 반복하지 않습니다.') : tr('게시물·채널·고정 대상·토론방 조건이 변경되었거나 삭제 권한을 확인하지 못했습니다. 현재 정보를 다시 검토해 주세요.')) }
}
// Who deletes a post is A1 §3-5 (channel-delete-authority.ts): the owner or a canDeleteMessages admin any post, an author
// their own; comments or media do not stop it. The server takes away the post's media, its discussion copy and the post
// count when the post is gone — the commit never touches the discussion room, whose rules an admin may not meet.
export function validatePostRemoval(uid: string, request: PostRemovalTarget, source: PostRemovalSource): ChannelDeleteRole {
  const { channel, post } = source
  if (channel.name !== `${documents}/channels/${request.channelId}` || !channel.updateTime || documentVersion(channel) !== request.channelVersion || channelPinReference(channel).status === 'unknown' || channelDiscussionReference(channel).status === 'unknown' ||
    !post || post.name !== `${channel.name}/posts/${request.postId}` || !post.updateTime || channelPostRevision(post) !== request.revision || stringField(post.fields, 'channelId', 160) !== request.channelId) throw new ChannelPostRemovalFailure(false)
  const role = channelDeleteRole(uid, channel, source.admin, stringField(post.fields, 'authorId', 160))
  if (role === 'none') throw new ChannelPostRemovalFailure(false)
  return role
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostRemoval(client: CommitClient, auth: Metadata, uid: string, input: PostRemovalTarget, source: PostRemovalSource, signal: AbortSignal): Promise<void> {
  const request = postRemovalTarget(input)
  if (signal.aborted) throw new ChannelPostRemovalFailure(false)
  const role = validatePostRemoval(uid, request, source)
  const { channel, post } = source, reference = channelPinReference(channel)
  const pointer = reference.postId === request.postId ? undefined : channel.fields.pinnedPostId
  // Only the owner may write the channel document (its pin pointer, checked against the channel's version); anyone
  // else deletes the post alone.
  const owner = role === 'owner'
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostRemovalFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostRemovalFailure(true)) }
    const call = client.commit({ database, writes: [
      { delete: post!.name, currentDocument: { updateTime: post!.updateTime } },
      ...(owner ? [{ update: { name: channel.name, fields: pointer === undefined ? {} : { pinnedPostId: pointer } }, updateMask: { fieldPaths: ['pinnedPostId'] }, currentDocument: { updateTime: channel.updateTime } }] : [])
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostRemovalFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code), error.code)); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== (owner ? 2 : 1) || !response.commitTime) throw new Error('Incomplete post removal commit')
        timestamp(response.commitTime, ''); object(response.writeResults[0]); if (owner) timestamp(object(object(response.writeResults[1]).updateTime), ''); finish()
      } catch { finish(new ChannelPostRemovalFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
