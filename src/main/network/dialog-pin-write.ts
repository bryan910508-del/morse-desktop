import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import type { DialogPinOrderRequest, DialogPinRequest } from '../../shared/dialog-pins'
import { identifier } from '../../shared/validation'
import { database, documents, documentVersion, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class DialogPinWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('고정 저장 결과를 확인하지 못했습니다. 다시 변경하기 전에 고정 상태를 확인해 주세요.')
    : tr('고정 상태가 바뀌었거나 저장 권한을 확인하지 못했습니다. 최신 목록에서 다시 선택해 주세요.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
// One pin document as this account keeps it (iOS MorseDialogPinSync writes the same four fields).
function pinWrite(path: string, pinned: boolean, rank: number, operation: string, doc: FirestoreDocument | undefined): WireObject {
  return {
    update: { name: path, fields: { isPinned: { booleanValue: pinned }, rank: { doubleValue: rank }, operationId: { stringValue: operation } } },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: doc ? { updateTime: doc.updateTime } : { exists: false }
  }
}
// One commit, no transaction (a transaction is refused here); each write holds to the copy it was made from.
function commitPins(client: CommitClient, auth: Metadata, writes: WireObject[], signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DialogPinWriteFailure(false)
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (error?: DialogPinWriteFailure): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) reject(error); else resolve()
    }
    const cancel = (): void => { call.cancel(); finish(new DialogPinWriteFailure(true)) }
    const call = client.commit({ database, writes }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
      if (error) {
        const definite = [status.ABORTED, status.ALREADY_EXISTS, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND, status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code)
        finish(new DialogPinWriteFailure(!definite)); return
      }
      try {
        if (!Array.isArray(response.writeResults) || response.writeResults.length !== writes.length || !response.commitTime) throw new Error('Invalid pin commit')
        timestamp(response.commitTime, ''); finish()
      } catch { finish(new DialogPinWriteFailure(true)) }
    })
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
export async function writeDialogPin(client: CommitClient, auth: Metadata, uid: string, request: DialogPinRequest, rank: number,
  doc: FirestoreDocument | undefined, signal: AbortSignal): Promise<void> {
  const path = `${documents}/users/${identifier(uid)}/dialogStates/${identifier(request.chatId)}`
  identifier(request.id)
  if (!Number.isFinite(rank) || rank < 0 || rank > 1e12 ||
    (doc ? doc.name !== path || !doc.updateTime || documentVersion(doc) !== request.version : request.version !== '')) throw new DialogPinWriteFailure(false)
  await commitPins(client, auth, [pinWrite(path, request.pinned, rank, request.id, doc)], signal)
}
// B502: the new order in one commit. Every chat is pinned already and keeps its pin; only its rank moves. Each write
// carries its own operation id (iOS gives each reordered pin a new one), and holds to the pin copy the order was read
// from, so a pin changed meanwhile on another device fails the whole order rather than half of it.
export async function writeDialogPinOrder(client: CommitClient, auth: Metadata, uid: string, request: DialogPinOrderRequest,
  docs: readonly FirestoreDocument[], signal: AbortSignal): Promise<void> {
  identifier(request.id)
  if (docs.length !== request.chats.length) throw new DialogPinWriteFailure(false)
  const writes = request.chats.map((chat, index) => {
    const path = `${documents}/users/${identifier(uid)}/dialogStates/${identifier(chat.chatId)}`, doc = docs[index]!
    if (doc.name !== path || !doc.updateTime || documentVersion(doc) !== chat.version || doc.fields.isPinned?.booleanValue !== true ||
      !Number.isFinite(chat.rank) || chat.rank <= 0 || chat.rank > 1e12) throw new DialogPinWriteFailure(false)
    return pinWrite(path, true, chat.rank, `${request.id}:${index}`, doc)
  })
  await commitPins(client, auth, writes, signal)
}
