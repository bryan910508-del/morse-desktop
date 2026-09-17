import type { ClientReadableStream, ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { profileNameEdit, type ProfileNameEdit } from '../../shared/profile-name'
import { profilePhotoClear, type ProfilePhotoClear } from '../../shared/profile-photo-clear'
import { profileUploadURL } from '../storage/profile-photo-upload-table'

import { identifier, object } from '../../shared/validation'
import { boolField, childId, database, document, documents, documentVersion, mapField, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export type ProfileDisplayEdit = { kind: 'name'; edit: ProfileNameEdit } | { kind: 'clear-photo'; edit: ProfilePhotoClear } | { kind: 'photo'; edit: ProfilePhotoClear; photoId: string; url: string }
export class ProfileDisplayWriteFailure extends Error {
  constructor(readonly uncertain: boolean, message: string) { super(message) }
}
interface DisplayClient {
  batchGetDocuments(request: WireObject, metadata: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  runQuery(request: WireObject, metadata: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const maxTargets = 449, maxReadBytes = 4 * 1024 * 1024, maxWriteBytes = 512 * 1024
const definite = new Set([status.ABORTED, status.ALREADY_EXISTS, status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])
const capacity = (): never => { throw new ProfileDisplayWriteFailure(false, tr('관련 정보를 한 번에 저장할 수 없습니다. 이 기기의 프로필 변경은 관련 문서 449개까지 지원합니다. 프로필 표시 정보는 변경하지 않았습니다.')) }

// One commit covers the user and every eligible document in the bounded
// snapshot. No root-first write, chunks, per-document fallback or offline retry.
export async function writeProfileDisplay(client: DisplayClient, auth: Metadata, uid: string, change: ProfileDisplayEdit,
  signal: AbortSignal, validate: () => void, beforeCommit: () => Promise<void> = async () => {}): Promise<number> {
  const edit = change.kind === 'name' ? profileNameEdit(change.edit) : profilePhotoClear(change.edit)
  const field = change.kind === 'name' ? 'displayName' : 'photoURL'
  const value = change.kind === 'photo' ? profileUploadURL(change.url, uid, change.photoId) : 'displayName' in edit ? edit.displayName : ''
  const action = change.kind === 'name' ? tr('이름 저장') : change.kind === 'photo' ? tr('사진 적용') : tr('사진 제거')
  const userPath = `${documents}/users/${identifier(uid)}`
  let bytes = 0, examined = 0, committing = false
  const current = (): void => { signal.throwIfAborted(); validate() }
  const read = (method: 'batchGetDocuments' | 'runQuery', request: WireObject, consume: (raw: WireObject) => void): Promise<void> => {
    current()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) { stream.cancel(); reject(error) } else resolve()
      }
      const cancel = (): void => finish(new Error('Profile preparation cancelled'))
      const stream = client[method](request, auth, { deadline: new Date(Date.now() + 30000) })
      stream.on('data', (raw: WireObject) => {
        if (settled) return
        try {
          current(); bytes += Buffer.byteLength(JSON.stringify(raw))
          if (bytes > maxReadBytes) throw new ProfileDisplayWriteFailure(false, tr('관련 정보를 한 번에 읽을 수 없습니다. 프로필 표시 정보는 변경하지 않았습니다.'))
          consume(raw)
        } catch (error) { finish(error) }
      })
      stream.on('error', error => finish(error))
      stream.on('end', () => finish())
      stream.on('close', () => { if (!settled) finish(new Error('Incomplete profile snapshot')) })
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
  }
  try {
    current()
    const users: { doc: FirestoreDocument; readTime: WireObject }[] = []
    await read('batchGetDocuments', { database, documents: [userPath], mask: { fieldPaths: ['displayName', 'photoURL', 'accountDeleted', 'userId'] } }, raw => {
      if (!raw.found || users.length || !raw.readTime) throw new Error('Missing current profile')
      const doc = document(raw.found), readTime = object(raw.readTime)
      timestamp(readTime, '')
      if (doc.name !== userPath || documentVersion(doc) !== edit.version || boolField(doc.fields, 'accountDeleted') || !stringField(doc.fields, 'userId', 160)) throw new Error('Profile changed')
      if (change.kind === 'clear-photo' && (typeof doc.fields.photoURL?.stringValue !== 'string' || !doc.fields.photoURL.stringValue)) throw new Error('No current photo')
      users.push({ doc, readTime })
    })
    const source = users[0]
    if (!source || users.length !== 1) throw new Error('Incomplete profile read')
    const writes: WireObject[] = [{ update: { name: userPath, fields: { [field]: { stringValue: value } } },
      updateMask: { fieldPaths: [field] }, currentDocument: { updateTime: source.doc.updateTime } }]
    const seen = new Set<string>([userPath])
    const ownField = `\`${uid.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
    const groups = [
      { collection: 'chats', owner: 'participantUids', op: 'ARRAY_CONTAINS', fields: ['participantUids', 'type', 'channelId', 'isChannelDiscussion', `participantInfo.${ownField}.accountDeleted`] },
      { collection: 'channels', owner: 'ownerId', op: 'EQUAL', fields: ['ownerId'] },
      { collection: 'channelInquiries', owner: 'subscriberId', op: 'EQUAL', fields: ['subscriberId'] }
    ] as const
    for (const group of groups) {
      let hasReadTime = false
      await read('runQuery', { parent: documents, readTime: source.readTime, structuredQuery: {
        from: [{ collectionId: group.collection }], select: { fields: group.fields.map(fieldPath => ({ fieldPath })) },
        where: { fieldFilter: { field: { fieldPath: group.owner }, op: group.op, value: { stringValue: uid } } },
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: maxTargets - examined + 1 }
      } }, raw => {
        if (raw.readTime) { timestamp(raw.readTime, ''); hasReadTime = true }
        if (raw.skippedResults) throw new Error('Incomplete profile query')
        if (!raw.document) return
        if (++examined > maxTargets) capacity()
        const doc = document(raw.document), id = childId(doc.name, `${documents}/${group.collection}`)
        if (seen.has(doc.name) || !doc.updateTime || !documentVersion(doc)) throw new Error('Invalid profile target')
        seen.add(doc.name)
        let fields: Record<string, WireObject>, fieldPath: string
        if (group.collection === 'chats') {
          const members = object(doc.fields.participantUids?.arrayValue).values
          if (!Array.isArray(members) || !members.some(value => object(value).stringValue === uid)) throw new Error('Chat membership changed')
          const kind = stringField(doc.fields, 'type', 32)
          if (!['direct', 'group', 'secret'].includes(kind)) throw new Error('Unsupported profile target')
          if (id.startsWith('channel_discuss_') || stringField(doc.fields, 'channelId', 160) || boolField(doc.fields, 'isChannelDiscussion')) return
          if (boolField(mapField(mapField(doc.fields, 'participantInfo'), uid), 'accountDeleted')) throw new Error('Withdrawn profile cache')
          fields = { participantInfo: { mapValue: { fields: { [uid]: { mapValue: { fields: { [field]: { stringValue: value } } } } } } } }
          fieldPath = `participantInfo.${ownField}.${field}`
        } else {
          if (stringField(doc.fields, group.owner, 160) !== uid) throw new Error('Profile target ownership changed')
          fields = group.collection === 'channels' ? { ownerInfo: { mapValue: { fields: { [field]: { stringValue: value } } } } } : { [change.kind === 'name' ? 'subscriberName' : 'subscriberPhotoURL']: { stringValue: value } }
          fieldPath = group.collection === 'channels' ? `ownerInfo.${field}` : change.kind === 'name' ? 'subscriberName' : 'subscriberPhotoURL'
        }
        writes.push({ update: { name: doc.name, fields }, updateMask: { fieldPaths: [fieldPath] }, currentDocument: { updateTime: doc.updateTime } })
      })
      // Even an empty successful query returns a readTime. Stream closure alone
      // must not turn a missing snapshot into an empty collection.
      if (!hasReadTime) throw new Error('Missing profile query snapshot')
    }
    current()
    const request = { database, writes }
    if (Buffer.byteLength(JSON.stringify(request)) > maxWriteBytes) capacity()
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
    return writes.length - 1
  } catch (error) {
    if (error instanceof ProfileDisplayWriteFailure) throw error
    const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
    const uncertain = committing && (code === undefined || !definite.has(code))
    throw new ProfileDisplayWriteFailure(uncertain, uncertain ? tr('{0} 결과를 확인하지 못했습니다. 자동으로 다시 요청하지 않습니다. 서버 정보를 다시 불러와 주세요.', [action])
      : tr('프로필이나 관련 대화가 변경되었거나 저장 권한을 확인하지 못했습니다. 프로필 표시 정보는 변경하지 않았습니다. 최신 정보를 다시 불러와 주세요.'))
  }
}
