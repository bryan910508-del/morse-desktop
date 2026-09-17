import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelPostPinEdit, type ChannelPostPinEdit } from '../../shared/channel-post-pin-edit'
import { channelPostRevision } from '../media/channel-post-media-document'
import { channelPinReference, channelPostPinFlag } from '../accounts/channel-post-pins'
import { editablePostText } from './channel-post-text-write'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export interface ChannelPinWriteSource { channel: FirestoreDocument; previous: FirestoreDocument | null; next: FirestoreDocument | null }
export class ChannelPostPinFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('고정 변경 응답을 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다.') : tr('채널·게시물·고정 정보가 변경되었거나 소유자/작성자 조건을 확인하지 못했습니다. 현재 상태를 다시 확인해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostPin(client: CommitClient, auth: Metadata, uid: string, input: ChannelPostPinEdit, source: ChannelPinWriteSource, signal: AbortSignal): Promise<void> {
  const request = channelPostPinEdit(input), { channel } = source, reference = channelPinReference(channel)
  if (signal.aborted || channel.name !== `${documents}/channels/${request.channelId}` || !channel.updateTime || documentVersion(channel) !== request.channelVersion || stringField(channel.fields, 'ownerId', 160) !== uid || reference.status === 'unknown' || reference.postId !== (request.previous?.postId ?? null)) throw new ChannelPostPinFailure(false)
  const writes: WireObject[] = [{ update: { name: channel.name, fields: request.next ? { pinnedPostId: { stringValue: request.next.postId } } : {} }, updateMask: { fieldPaths: ['pinnedPostId'] }, currentDocument: { updateTime: channel.updateTime } }]
  for (const which of ['previous', 'next'] as const) {
    const expected = request[which], post = source[which]
    if (!expected) { if (post) throw new ChannelPostPinFailure(false); continue }
    if (!post || post.name !== `${channel.name}/posts/${expected.postId}` || !post.updateTime || channelPostRevision(post) !== expected.revision || stringField(post.fields, 'channelId', 160) !== request.channelId || stringField(post.fields, 'authorId', 160) !== uid || editablePostText(post) === null || channelPostPinFlag(post) !== (which === 'previous' ? 'pinned' : 'unpinned')) throw new ChannelPostPinFailure(false)
    writes.push({ update: { name: post.name, fields: { isPinned: { booleanValue: which === 'next' } } }, updateMask: { fieldPaths: ['isPinned'] }, currentDocument: { updateTime: post.updateTime } })
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostPinFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostPinFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostPinFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== writes.length || !response.commitTime) throw new Error('Incomplete pin commit')
        timestamp(response.commitTime, ''); for (const result of response.writeResults) timestamp(object(object(result).updateTime), ''); finish()
      } catch { finish(new ChannelPostPinFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
