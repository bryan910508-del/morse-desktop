import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelIntroductionEdit, type ChannelIntroductionEdit } from '../../shared/channel-introduction'
import { database, documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelIntroductionWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('채널 소개 저장 결과를 확인하지 못했습니다. 다시 저장하지 않고 현재 채널 정보를 확인해 주세요.') : tr('채널 정보가 변경되었거나 저장 권한을 확인하지 못했습니다. 최신 정보에서 다시 편집해 주세요.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
export async function writeChannelIntroduction(client: CommitClient, auth: Metadata, edit: ChannelIntroductionEdit, doc: FirestoreDocument, signal: AbortSignal): Promise<void> {
  const request = channelIntroductionEdit(edit), path = `${documents}/channels/${request.channelId}`
  if (signal.aborted || doc.name !== path || !doc.updateTime || documentVersion(doc) !== request.version) throw new ChannelIntroductionWriteFailure(false)
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: ChannelIntroductionWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new ChannelIntroductionWriteFailure(true)) }
    const call = client.commit({ database, writes: [{ update: { name: path, fields: { description: { stringValue: request.text } } },
      updateMask: { fieldPaths: ['description'] }, currentDocument: { updateTime: doc.updateTime } }] }, auth,
    { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new ChannelIntroductionWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== 1 || !response.commitTime) throw new Error('Invalid group announcement commit')
        timestamp(response.commitTime, ''); finish()
      } catch { finish(new ChannelIntroductionWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
