import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelPostLikeRequest, type ChannelPostLikeRequest } from '../../shared/channel-post-like'
import { database, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { channelPostRevision } from '../media/channel-post-media-document'
import { channelPostLikeState } from '../accounts/channel-post-like-state'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class ChannelPostLikeFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('좋아요 변경 결과를 확인하지 못했습니다. 같은 요청을 반복하지 말고 현재 게시물을 확인해 주세요.') : tr('게시물이나 좋아요 상태가 변경되었거나 쓰기 권한을 확인하지 못했습니다. 최신 게시물에서 다시 선택해 주세요.')) }
}
interface CommitClient { commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall }
export async function writeChannelPostLike(client: CommitClient, auth: Metadata, uid: string, input: ChannelPostLikeRequest, doc: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = channelPostLikeRequest(input), path = `${documents}/channels/${request.channelId}/posts/${request.postId}`, { info, members } = channelPostLikeState(doc, uid)
  if (signal.aborted || doc.name !== path || !doc.updateTime || channelPostRevision(doc) !== request.revision || info.status !== 'ready' || !members || info.selected !== request.selected || info.count !== request.count) throw new ChannelPostLikeFailure(false)
  const next = request.desired ? [...members, uid] : members.filter(member => member !== uid)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelPostLikeFailure): void => { if (settled) return; settled = true; signal.removeEventListener('abort', cancel); if (error) reject(error); else resolve() }
    const cancel = (): void => { call.cancel(); finish(new ChannelPostLikeFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields: { likedBy: { arrayValue: { values: next.map(member => ({ stringValue: member })) } }, likeCount: { integerValue: String(next.length) } } },
      updateMask: { fieldPaths: ['likedBy', 'likeCount'] }, currentDocument: { updateTime: doc.updateTime } }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) { finish(new ChannelPostLikeFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete like commit')
        timestamp(response.commitTime, ''); timestamp(object(object(response.writeResults[0]).updateTime), ''); finish()
      } catch { finish(new ChannelPostLikeFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
