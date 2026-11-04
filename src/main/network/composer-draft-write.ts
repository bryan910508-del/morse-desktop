import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { identifier, object } from '../../shared/validation'
import { database, documents, timestamp, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

// B530: the account's cloud copy of a chat's unsent text, users/{uid}/composerDrafts/{chatId} = { text ≤ 8000,
// updatedAt }, the document iOS ChatComposerDraftService and Android AccountRemoteComposerDrafts write (rules: only
// the owner, text a string of at most 8000, updatedAt a timestamp). An empty draft deletes the document. Telegram keeps
// the same on the account (messages.saveDraft, tdesktop ApiWrap::saveDraftToCloud apiwrap.cpp:2515); the time is the
// server's (REQUEST_TIME), as the draft date tdesktop compares is the server's (data_drafts.cpp:108).
export const maxCloudDraftChars = 8000
// retry: the write did not reach the server or its answer was lost (offline, a sign-in token not renewed, a deadline), so
// it is tried again once the network is back; a refusal by the rules or a bad value is not.
export class ComposerDraftWriteFailure extends Error {
  constructor(readonly retry: boolean) { super(retry ? tr('저장 결과를 확인하지 못했습니다.') : tr('저장하지 못했습니다.')) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
// An expired sign-in (UNAUTHENTICATED) is signed in again on the next try, so only these are a refusal.
const definite = new Set([status.PERMISSION_DENIED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])
// The server's time of the commit, in nanoseconds: a snapshot of the document no later than it is this write or older.
export type CommitTime = bigint
export function commitNanos(raw: unknown): CommitTime {
  const at = timestamp(raw, '')
  return BigInt(at.seconds) * 1_000_000_000n + BigInt(at.nanoseconds)
}

export function writeComposerDraft(client: CommitClient, auth: Metadata, uid: string, chatId: string, text: string, signal: AbortSignal, validate: () => void): Promise<CommitTime> {
  identifier(uid); identifier(chatId)
  if (typeof text !== 'string' || text.length > maxCloudDraftChars) throw new ComposerDraftWriteFailure(false)
  const name = `${documents}/users/${uid}/composerDrafts/${chatId}`
  const write: WireObject = text
    ? { update: { name, fields: { text: { stringValue: text } } }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] }
    : { delete: name }
  signal.throwIfAborted(); validate()
  return new Promise((done, reject) => {
    let settled = false
    const finish = (error: unknown, response?: WireObject): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (!error) {
        try { done(commitNanos(object(response).commitTime)) } catch { reject(new ComposerDraftWriteFailure(true)) }
        return
      }
      const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
      reject(error instanceof ComposerDraftWriteFailure ? error : new ComposerDraftWriteFailure(!(typeof code === 'number' && definite.has(code))))
    }
    const cancel = (): void => { call.cancel(); finish(new ComposerDraftWriteFailure(true)) }
    const call = client.commit({ database, writes: [write] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => finish(error, response))
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
  })
}
