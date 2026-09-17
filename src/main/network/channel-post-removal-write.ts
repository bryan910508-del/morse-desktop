import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { postRemovalTarget, type PostRemovalTarget } from '../../shared/channel-post-removal'
import { channelPostRevision } from '../media/channel-post-media-document'
import { channelPinReference } from '../accounts/channel-post-pins'
import { channelDiscussionReference } from '../accounts/channel-discussion-reference'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export interface PostRemovalSource { channel: FirestoreDocument; post: FirestoreDocument | null }
export class ChannelPostRemovalFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('게시물 삭제 응답을 확인하지 못했습니다. 이미 반영되었을 수 있어 같은 요청을 반복하지 않습니다.') : tr('게시물·채널·고정 대상·토론방 조건이 변경되었거나 삭제 권한을 확인하지 못했습니다. 현재 정보를 다시 검토해 주세요.')) }
}
export function postRemovalContentEligible(post: FirestoreDocument): boolean {
  const count = post.fields.commentCount
  const zero = count?.integerValue === '0' || count?.integerValue === 0 || (count?.integerValue === undefined && count?.doubleValue === 0)
  return zero && ['mediaKeys', 'mediaTypes', 'thumbnailKeys'].every(key => post.fields[key] === undefined)
}
export function validatePostRemoval(uid: string, request: PostRemovalTarget, source: PostRemovalSource): void {
  const { channel, post } = source
  if (channel.name !== `${documents}/channels/${request.channelId}` || !channel.updateTime || documentVersion(channel) !== request.channelVersion || stringField(channel.fields, 'ownerId', 160) !== uid || channelPinReference(channel).status === 'unknown' || channelDiscussionReference(channel).status === 'unknown' ||
    !post || post.name !== `${channel.name}/posts/${request.postId}` || !post.updateTime || channelPostRevision(post) !== request.revision || stringField(post.fields, 'channelId', 160) !== request.channelId || stringField(post.fields, 'authorId', 160) !== uid || !postRemovalContentEligible(post)) throw new ChannelPostRemovalFailure(false)
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostRemoval(client: CommitClient, auth: Metadata, uid: string, input: PostRemovalTarget, source: PostRemovalSource, signal: AbortSignal): Promise<void> {
  const request = postRemovalTarget(input)
  if (signal.aborted) throw new ChannelPostRemovalFailure(false)
  validatePostRemoval(uid, request, source)
  const { channel, post } = source, reference = channelPinReference(channel)
  const pointer = reference.postId === request.postId ? undefined : channel.fields.pinnedPostId
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostRemovalFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostRemovalFailure(true)) }
    const call = client.commit({ database, writes: [
      { delete: post!.name, currentDocument: { updateTime: post!.updateTime } },
      { update: { name: channel.name, fields: pointer === undefined ? {} : { pinnedPostId: pointer } }, updateMask: { fieldPaths: ['pinnedPostId'] }, currentDocument: { updateTime: channel.updateTime } }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostRemovalFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Incomplete post removal commit')
        timestamp(response.commitTime, ''); object(response.writeResults[0]); timestamp(object(object(response.writeResults[1]).updateTime), ''); finish()
      } catch { finish(new ChannelPostRemovalFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
