import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelAccessRequest, type ChannelAccessRequest } from '../../shared/channel-access-edit'
import { database, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
import { tr } from '../../shared/i18n'
export class ChannelAccessFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('이 단계의 처리 결과를 확인하지 못했습니다. 다시 제출하지 않습니다.') : tr('이 단계를 시작하지 못했거나 서버가 요청을 거절했습니다.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
export async function writeChannelAccess(client: CommitClient, auth: Metadata, uid: string, edit: ChannelAccessRequest, doc: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = channelAccessRequest(edit), path = `${documents}/channels/${request.channelId}`, next = request.next
  if (request.mode !== 'edit' || signal.aborted || doc.name !== path || !doc.updateTime || documentVersion(doc) !== request.version || stringField(doc.fields, 'ownerId', 160) !== uid) throw new ChannelAccessFailure(false)
  const fields: Record<string, WireObject> = { type: { stringValue: next.type }, isPublic: { booleanValue: next.type === 'public' }, joinPolicy: { stringValue: next.joinPolicy }, chatMode: { stringValue: next.chatMode }, discussionHistoryVisible: { booleanValue: next.historyVisible } }
  if (next.category) fields.category = { stringValue: next.category }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelAccessFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new ChannelAccessFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields }, updateMask: { fieldPaths: ['type', 'isPublic', 'joinPolicy', 'chatMode', 'discussionHistoryVisible', 'category'] }, currentDocument: { updateTime: doc.updateTime } }] }, auth,
      { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error) { finish(new ChannelAccessFailure(![status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code))); return }
        try {
          if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Incomplete settings commit')
          timestamp(response.commitTime, ''); timestamp(object(object(response.writeResults[0]).updateTime), ''); finish()
        } catch { finish(new ChannelAccessFailure(true)) }
      })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
