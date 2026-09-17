import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { randomUUID } from 'node:crypto'
import { identifier } from '../../shared/validation'
import { database, documents, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

// This account's «알림 끄기» / «보관» for a chat, in the document iOS MorseDialogMuteSync and Android
// AccountDialogPreferenceSync write: users/{uid}/settings/dialog_{chatId} with kind, chatId, isMuted, isArchived,
// operationId and updatedAt. The push functions (onChatMessageCreated) read isMuted before notifying this account,
// so the mute reaches the phone's notifications too; the room document everyone shares is not touched
// (Telegram: peer notification settings belong to the account, `updatePeerMuteSetting`).
export class DialogPreferenceWriteFailure extends Error {
  constructor(readonly uncertain: boolean) { super(uncertain ? tr('알림 설정 저장 결과를 확인하지 못했습니다.') : tr('알림 설정을 저장하지 못했습니다.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])
export interface DialogPreferenceWrite { chatId: string; muted: boolean; archived: boolean; operationId?: string }

export function writeDialogPreference(client: CommitClient, auth: Metadata, uid: string, input: DialogPreferenceWrite, signal: AbortSignal, validate: () => void): Promise<void> {
  const chatId = identifier(input.chatId)
  identifier(uid)
  if (typeof input.muted !== 'boolean' || typeof input.archived !== 'boolean') throw new DialogPreferenceWriteFailure(false)
  const name = `${documents}/users/${uid}/settings/dialog_${chatId}`
  const fields: Record<string, WireObject> = {
    kind: { stringValue: 'dialogPreference' }, chatId: { stringValue: chatId },
    isMuted: { booleanValue: input.muted }, isArchived: { booleanValue: input.archived },
    operationId: { stringValue: input.operationId ?? randomUUID() }
  }
  signal.throwIfAborted(); validate()
  return new Promise((done, reject) => {
    let settled = false
    const finish = (error: unknown): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (!error) { done(); return }
      const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
      reject(error instanceof DialogPreferenceWriteFailure ? error : new DialogPreferenceWriteFailure(!(typeof code === 'number' && definite.has(code))))
    }
    const cancel = (): void => { call.cancel(); finish(new DialogPreferenceWriteFailure(true)) }
    const call = client.commit({ database, writes: [
      { update: { name, fields }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }
    ] }, auth, { deadline: new Date(Date.now() + 30000) }, error => finish(error))
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
