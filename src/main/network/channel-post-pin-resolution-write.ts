import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelPostPinResolution, type ChannelPostPinResolution } from '../../shared/channel-post-pin-resolution'
import { channelPostRevision } from '../media/channel-post-media-document'
import { channelPinReference, channelPostPinFlag } from '../accounts/channel-post-pins'
import { editablePostText } from './channel-post-text-write'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export interface PinResolutionWriteSource { channel: FirestoreDocument; post: FirestoreDocument }
export class ChannelPostPinResolutionFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('지정 게시물 고정 변경 응답을 확인하지 못했습니다. 같은 요청을 자동 반복하지 않습니다.') : tr('채널 대상·게시물·작성자 또는 고정 표시가 변경되었습니다. 현재 값을 다시 확인해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostPinResolution(client: CommitClient, auth: Metadata, uid: string, input: ChannelPostPinResolution, source: PinResolutionWriteSource, signal: AbortSignal): Promise<void> {
  const request = channelPostPinResolution(input), { channel, post } = source, reference = channelPinReference(channel)
  if (signal.aborted || channel.name !== `${documents}/channels/${request.channelId}` || !channel.updateTime || documentVersion(channel) !== request.channelVersion || stringField(channel.fields, 'ownerId', 160) !== uid || reference.status !== 'known' || reference.postId !== request.postId ||
    post.name !== `${channel.name}/posts/${request.postId}` || !post.updateTime || channelPostRevision(post) !== request.revision || stringField(post.fields, 'channelId', 160) !== request.channelId || stringField(post.fields, 'authorId', 160) !== uid || editablePostText(post) === null || channelPostPinFlag(post) !== 'unpinned') throw new ChannelPostPinResolutionFailure(false)
  // Preserve or delete only the currently referenced post ID, as explicitly selected.
  const pointer = request.action === 'restore' ? channel.fields.pinnedPostId : undefined
  const writes: WireObject[] = [
    { update: { name: channel.name, fields: pointer === undefined ? {} : { pinnedPostId: pointer } }, updateMask: { fieldPaths: ['pinnedPostId'] }, currentDocument: { updateTime: channel.updateTime } },
    { update: { name: post.name, fields: { isPinned: { booleanValue: request.action === 'restore' } } }, updateMask: { fieldPaths: ['isPinned'] }, currentDocument: { updateTime: post.updateTime } }
  ]
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostPinResolutionFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostPinResolutionFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostPinResolutionFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 2 || !response.commitTime) throw new Error('Incomplete referenced pin commit')
        timestamp(response.commitTime, ''); for (const result of response.writeResults) timestamp(object(object(result).updateTime), ''); finish()
      } catch { finish(new ChannelPostPinResolutionFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
