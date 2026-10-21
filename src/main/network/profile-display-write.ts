import type { ClientReadableStream, ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { profileNameEdit, type ProfileNameEdit } from '../../shared/profile-name'
import { profilePhotoClear, type ProfilePhotoClear } from '../../shared/profile-photo-clear'
import { profileUploadURL } from '../storage/profile-photo-upload-table'

import { identifier, object } from '../../shared/validation'
import { boolField, database, document, documents, documentVersion, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export type ProfileDisplayEdit = { kind: 'name'; edit: ProfileNameEdit } | { kind: 'clear-photo'; edit: ProfilePhotoClear } | { kind: 'photo'; edit: ProfilePhotoClear; photoId: string; url: string }
export class ProfileDisplayWriteFailure extends Error {
  constructor(readonly uncertain: boolean, message: string) { super(message) }
}
interface DisplayClient {
  batchGetDocuments(request: WireObject, metadata: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.ABORTED, status.ALREADY_EXISTS, status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])

// B481 ③: a name or photo change writes this account's own profile and nothing else. The copies other accounts read —
// a room's participantInfo, a channel's ownerInfo and subscriber record, an inquiry room's subscriberName/PhotoURL, a
// join request — are the server's to keep in step (publicProfiles → syncMorseParticipantInfo, B48 and B481 ②), as
// Telegram's server tells the others with updateUserName / updateUserPhoto and its client sends only its own
// account.updateProfile (tdesktop EditNameBox::save, boxes/add_contact_box.cpp:1660-1673, then Session::processUser,
// data/data_session.cpp:646). Writing those copies here once made one refused room (the notices chat, B478), a room past
// 449 or a room changed meanwhile fail the whole edit. Others see the change once the server has copied it (1–7 s).
export async function writeProfileDisplay(client: DisplayClient, auth: Metadata, uid: string, change: ProfileDisplayEdit,
  signal: AbortSignal, validate: () => void, beforeCommit: () => Promise<void> = async () => {}): Promise<void> {
  const edit = change.kind === 'name' ? profileNameEdit(change.edit) : profilePhotoClear(change.edit)
  const field = change.kind === 'name' ? 'displayName' : 'photoURL'
  const value = change.kind === 'photo' ? profileUploadURL(change.url, uid, change.photoId) : 'displayName' in edit ? edit.displayName : ''
  const action = change.kind === 'name' ? tr('이름 저장') : change.kind === 'photo' ? tr('사진 적용') : tr('사진 제거')
  const userPath = `${documents}/users/${identifier(uid)}`
  let committing = false
  const current = (): void => { signal.throwIfAborted(); validate() }
  const read = (request: WireObject, consume: (raw: WireObject) => void): Promise<void> => {
    current()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) { stream.cancel(); reject(error) } else resolve()
      }
      const cancel = (): void => finish(new Error('Profile preparation cancelled'))
      const stream = client.batchGetDocuments(request, auth, { deadline: new Date(Date.now() + 30000) })
      stream.on('data', (raw: WireObject) => {
        if (settled) return
        try { current(); consume(raw) } catch (error) { finish(error) }
      })
      stream.on('error', error => finish(error))
      stream.on('end', () => finish())
      stream.on('close', () => { if (!settled) finish(new Error('Incomplete profile snapshot')) })
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
  }
  try {
    current()
    const users: FirestoreDocument[] = []
    await read({ database, documents: [userPath], mask: { fieldPaths: ['displayName', 'photoURL', 'accountDeleted', 'userId'] } }, raw => {
      if (!raw.found || users.length) throw new Error('Missing current profile')
      const doc = document(raw.found)
      if (doc.name !== userPath || documentVersion(doc) !== edit.version || boolField(doc.fields, 'accountDeleted') || !stringField(doc.fields, 'userId', 160)) throw new Error('Profile changed')
      if (change.kind === 'clear-photo' && (typeof doc.fields.photoURL?.stringValue !== 'string' || !doc.fields.photoURL.stringValue)) throw new Error('No current photo')
      users.push(doc)
    })
    const source = users[0]
    if (!source || users.length !== 1) throw new Error('Incomplete profile read')
    const writes: WireObject[] = [{ update: { name: userPath, fields: { [field]: { stringValue: value } } },
      updateMask: { fieldPaths: [field] }, currentDocument: { updateTime: source.updateTime } }]
    current()
    const request = { database, writes }
    await beforeCommit()
    current()
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve()
      }
      const cancel = (): void => { call.cancel(); finish(new Error('Profile commit cancelled')) }
      current(); committing = true
      const call = client.commit(request, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error) { finish(error); return }
        try {
          if (!Array.isArray(response.writeResults) || response.writeResults.length !== writes.length || !response.commitTime) throw new Error('Incomplete profile commit')
          timestamp(response.commitTime, '')
          for (const result of response.writeResults) timestamp(object(object(result).updateTime), '')
          finish()
        } catch (error) { finish(error) }
      })
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
  } catch (error) {
    if (error instanceof ProfileDisplayWriteFailure) throw error
    const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
    const uncertain = committing && (code === undefined || !definite.has(code))
    throw new ProfileDisplayWriteFailure(uncertain, uncertain ? tr('{0} 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다. 서버 정보를 다시 불러와 주세요.', [action])
      : tr('프로필이나 관련 대화가 변경되었거나 저장 권한을 확인하지 못했습니다. 프로필 표시 정보는 변경하지 않았습니다. 최신 정보를 다시 불러와 주세요.'))
  }
}
