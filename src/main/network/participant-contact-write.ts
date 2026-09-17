import type { ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { identifier } from '../../shared/validation'
import { database, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { recordContactStep } from '../platform/contact-diagnostics'
import { tr } from '../../shared/i18n'

export interface ContactCreateFields { uid: string; userId: string; displayName: string; photoURL: string }
export class ParticipantContactWriteFailure extends Error {
  constructor(readonly uncertain: boolean, message: string) { super(message) }
}
interface CommitClient {
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])

// AppState.addContact (iOS): one create of users/{me}/contacts/{peer} with the name, Morse ID
// and photo address from the chat's participant info. The earlier transaction also read the
// chat, contact and blocked documents first; the server refused those reads (status 7).
export async function createParticipantContact(client: CommitClient, auth: Metadata, uid: string, chatId: string, peerUid: string,
  signal: AbortSignal, resolve: (doc?: FirestoreDocument) => ContactCreateFields): Promise<'added' | 'exists'> {
  identifier(uid); identifier(chatId); identifier(peerUid)
  const contactPath = `${documents}/users/${uid}/contacts/${peerUid}`
  let committing = false
  try {
    signal.throwIfAborted()
    const peer = resolve()
    if (peer.uid !== peerUid || uid === peerUid) throw new Error('Contact identity mismatch')
    committing = true
    const result = await new Promise<WireObject>((done, reject) => {
      let settled = false
      const finish = (error: unknown, response?: WireObject): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else done(response!)
      }
      const cancel = (): void => { call.cancel(); finish(new Error('Contact operation cancelled')) }
      const call = client.commit({ database, writes: [{
        update: { name: contactPath, fields: { userId: { stringValue: peer.userId }, displayName: { stringValue: peer.displayName }, photoURL: { stringValue: peer.photoURL } } },
        updateTransforms: [{ fieldPath: 'addedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false }
      }] }, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => finish(error, response))
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
    if (!Array.isArray(result.writeResults) || result.writeResults.length !== 1 || !result.commitTime) throw new Error('Invalid contact commit')
    timestamp(result.commitTime, '')
    return 'added'
  } catch (error) {
    const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
    // The contact document already exists: a contact is never overwritten.
    if (code === status.ALREADY_EXISTS) return 'exists'
    const uncertain = committing && (code === undefined || !definite.has(code))
    recordContactStep(committing ? 'commit-failed' : 'prepare-failed', code !== undefined ? `grpc-${code}` : error instanceof Error ? error.message : 'unknown')
    throw new ParticipantContactWriteFailure(uncertain, uncertain ? tr('저장 결과를 확인하지 못했습니다. 연락처 목록을 확인한 뒤 필요하면 다시 추가해 주세요.')
      : code === status.PERMISSION_DENIED ? tr('연락처를 저장할 권한을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')
        : tr('대화나 참여자 정보가 바뀌었습니다. 최신 목록에서 다시 선택해 주세요.'))
  }
}
