import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelPostExtraPin, type ChannelPostExtraPinRequest } from '../../shared/channel-post-extra-pin'
import { channelPostRevision } from '../media/channel-post-media-document'
import { channelPinReference, channelPostPinFlag } from '../accounts/channel-post-pins'
import { editablePostText } from './channel-post-text-write'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export interface ExtraPinWriteSource { channel: FirestoreDocument; post: FirestoreDocument }
export class ChannelPostExtraPinFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('별도 고정 표시 해제 응답을 확인하지 못했습니다. 같은 요청을 자동 반복하지 않습니다.') : tr('채널 대상·게시물·작성자 또는 고정 표시가 변경되었습니다. 현재 값을 다시 확인해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostExtraPin(client: CommitClient, auth: Metadata, uid: string, input: ChannelPostExtraPinRequest, source: ExtraPinWriteSource, signal: AbortSignal): Promise<void> {
  const request = channelPostExtraPin(input), { channel, post } = source, reference = channelPinReference(channel)
  if (signal.aborted || channel.name !== `${documents}/channels/${request.channelId}` || !channel.updateTime || documentVersion(channel) !== request.channelVersion || stringField(channel.fields, 'ownerId', 160) !== uid || reference.status === 'unknown' || reference.postId !== request.referenceId || reference.source !== request.referenceSource || reference.postId === request.postId ||
    post.name !== `${channel.name}/posts/${request.postId}` || !post.updateTime || channelPostRevision(post) !== request.revision || stringField(post.fields, 'channelId', 160) !== request.channelId || stringField(post.fields, 'authorId', 160) !== uid || editablePostText(post) === null || channelPostPinFlag(post) !== 'pinned') throw new ChannelPostExtraPinFailure(false)
  // Preserve the exact pointer representation while enforcing its version in the same commit.
  const pointer = channel.fields.pinnedPostId
  const writes: WireObject[] = [
    { update: { name: channel.name, fields: pointer === undefined ? {} : { pinnedPostId: pointer } }, updateMask: { fieldPaths: ['pinnedPostId'] }, currentDocument: { updateTime: channel.updateTime } },
    { update: { name: post.name, fields: { isPinned: { booleanValue: false } } }, updateMask: { fieldPaths: ['isPinned'] }, currentDocument: { updateTime: post.updateTime } }
  ]
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostExtraPinFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostExtraPinFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostExtraPinFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Incomplete extra pin commit')
        timestamp(response.commitTime, ''); for (const result of response.writeResults) timestamp(object(object(result).updateTime), ''); finish()
      } catch { finish(new ChannelPostExtraPinFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
