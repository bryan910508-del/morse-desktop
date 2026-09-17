import type { ClientReadableStream, ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { channelNameEdit, type ChannelNameEdit } from '../../shared/channel-name'
import { channelPhotoClear, type ChannelPhotoClear } from '../../shared/channel-photo-clear'
import { channelPhotoVersion } from '../../shared/channel-photo-upload'
import { channelPhotoKind, type ChannelPhotoKind } from '../../shared/channel-photo-bytes'
import { backgroundPhotoId } from '../../shared/chat-background'
import { channelPhotoUploadURL } from '../storage/channel-photo-upload-table'
import { identifier, object } from '../../shared/validation'
import { boolField, childId, database, document, documents, documentVersion, mapField, stringField, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { tr } from '../../shared/i18n'

export class ChannelMetadataWriteFailure extends Error { constructor(readonly uncertain: boolean, message: string) { super(message) } }
interface MetadataClient {
  batchGetDocuments(request: WireObject, auth: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  runQuery(request: WireObject, auth: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  commit(request: WireObject, auth: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.ABORTED, status.ALREADY_EXISTS, status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])

// Reuse the profile display-write pattern: one bounded read-time snapshot and
// one exact-version commit. New documents after that snapshot are not included.
interface UploadedPhotoEdit { id: string; channelId: string; version: string; url: string; kind: ChannelPhotoKind }
function uploadedPhotoEdit(edit: UploadedPhotoEdit): UploadedPhotoEdit {
  const id = backgroundPhotoId(edit.id), channelId = identifier(edit.channelId), kind = channelPhotoKind(edit.kind)
  return { id, channelId, kind, version: channelPhotoVersion(edit.version), url: channelPhotoUploadURL(edit.url, channelId, id, kind) }
}
type Change = { kind: 'name'; edit: ChannelNameEdit } | { kind: 'clear-photo'; edit: ChannelPhotoClear } |
  { kind: 'apply-photo'; edit: UploadedPhotoEdit; beforeCommit(): Promise<void> }
export async function writeChannelMetadata(client: MetadataClient, auth: Metadata, uid: string, change: Change, signal: AbortSignal, validate: () => void): Promise<number> {
  const edit = change.kind === 'name' ? channelNameEdit(change.edit) : change.kind === 'clear-photo' ? channelPhotoClear(change.edit) : uploadedPhotoEdit(change.edit)
  const isName = change.kind === 'name', isCover = change.kind !== 'name' && change.edit.kind === 'cover'
  const field = isName ? 'name' : isCover ? 'coverURL' : 'photoURL'
  const value = change.kind === 'name' ? channelNameEdit(change.edit).name : change.kind === 'apply-photo' ? uploadedPhotoEdit(change.edit).url : ''
  const label = isName ? tr('이름 변경') : isCover ? change.kind === 'apply-photo' ? tr('커버 적용') : tr('커버 해제') : change.kind === 'apply-photo' ? tr('대표 사진 적용') : tr('대표 사진 해제')
  const channelPath = `${documents}/channels/${edit.channelId}`
  identifier(uid)
  let bytes = 0, committing = false
  const current = () => { signal.throwIfAborted(); validate() }
  const read = (method: 'batchGetDocuments' | 'runQuery', request: WireObject, consume: (raw: WireObject) => void): Promise<void> => {
    current()
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) { stream.cancel(); reject(error) } else resolve()
      }
      const cancel = () => finish(new Error('Channel metadata preparation cancelled'))
      const stream = client[method](request, auth, { deadline: new Date(Date.now() + 30000) })
      stream.on('data', (raw: WireObject) => {
        if (settled) return
        try {
          current(); bytes += Buffer.byteLength(JSON.stringify(raw))
          if (bytes > 4 * 1024 * 1024) throw new ChannelMetadataWriteFailure(false, tr('{0}에 필요한 정보를 한 번에 읽을 수 없습니다. 저장하지 않았습니다.', [label]))
          consume(raw)
        } catch (error) { finish(error) }
      })
      stream.on('error', error => finish(error)); stream.on('end', () => finish())
      stream.on('close', () => { if (!settled) finish(new Error('Incomplete channel snapshot')) })
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
  }
  try {
    const roots: { doc: FirestoreDocument; readTime: WireObject }[] = []
    await read('batchGetDocuments', { database, documents: [channelPath], mask: { fieldPaths: ['ownerId', field, 'discussionChatId'] } }, raw => {
      if (!raw.found || roots.length || !raw.readTime) throw new Error('Missing channel')
      const doc = document(raw.found), readTime = object(raw.readTime)
      timestamp(readTime, '')
      if (doc.name !== channelPath || documentVersion(doc) !== edit.version || stringField(doc.fields, 'ownerId', 160) !== uid) throw new Error('Channel changed')
      if (change.kind === 'clear-photo' && (typeof doc.fields[field]?.stringValue !== 'string' || !doc.fields[field].stringValue)) throw new Error('No photo to clear')
      roots.push({ doc, readTime })
    })
    const root = roots[0]
    if (!root || roots.length !== 1) throw new Error('Incomplete channel read')
    const writes: WireObject[] = [{ update: { name: channelPath, fields: { [field]: { stringValue: value } } }, updateMask: { fieldPaths: [field] }, currentDocument: { updateTime: root.doc.updateTime } }]
    if (!isCover) {
      // Follow the server-created discussion ID; legacy fallback matches its contract.
      const discussionId = identifier(stringField(root.doc.fields, 'discussionChatId', 160) || `channel_discuss_${edit.channelId}`)
      const discussionPath = `${documents}/chats/${discussionId}`, ownField = `\`${uid.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
      let discussionFound = false
      await read('batchGetDocuments', { database, documents: [discussionPath], readTime: root.readTime,
        mask: { fieldPaths: ['type', 'channelId', 'isChannelDiscussion', 'createdBy', 'participantUids', `participantInfo.${ownField}.accountDeleted`] } }, raw => {
        if (!raw.found || discussionFound || !raw.readTime) throw new Error('Missing discussion')
        timestamp(raw.readTime, '')
        const doc = document(raw.found), members = object(doc.fields.participantUids?.arrayValue).values
        if (doc.name !== discussionPath || !doc.updateTime || !documentVersion(doc) || stringField(doc.fields, 'type', 32) !== 'group' ||
            !boolField(doc.fields, 'isChannelDiscussion') || stringField(doc.fields, 'channelId', 160) !== edit.channelId || stringField(doc.fields, 'createdBy', 160) !== uid ||
            !Array.isArray(members) || !members.some(value => object(value).stringValue === uid) || boolField(mapField(mapField(doc.fields, 'participantInfo'), uid), 'accountDeleted')) throw new Error('Discussion identity changed')
        discussionFound = true
        const ownPhotoField = isName ? 'displayName' : 'photoURL'
        writes.push({ update: { name: discussionPath, fields: {
          [isName ? 'name' : 'photoURL']: { stringValue: value },
          ...(!isName ? { cachedPhotoURL: { stringValue: value } } : {}),
          participantInfo: { mapValue: { fields: { [uid]: { mapValue: { fields: { [ownPhotoField]: { stringValue: value } } } } } } }
        } }, updateMask: { fieldPaths: [isName ? 'name' : 'photoURL', ...(!isName ? ['cachedPhotoURL'] : []), `participantInfo.${ownField}.${ownPhotoField}`] }, currentDocument: { updateTime: doc.updateTime } })
      })
      if (!discussionFound) throw new Error('Incomplete discussion read')
      let examined = 0, hasReadTime = false
      const seen = new Set<string>()
      await read('runQuery', { parent: documents, readTime: root.readTime, structuredQuery: {
        from: [{ collectionId: 'channelInquiries' }], select: { fields: ['channelOwnerId', 'channelId', 'channelDeleted'].map(fieldPath => ({ fieldPath })) },
        where: { fieldFilter: { field: { fieldPath: 'channelOwnerId' }, op: 'EQUAL', value: { stringValue: uid } } },
        orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: { value: 450 }
      } }, raw => {
        if (raw.readTime) { timestamp(raw.readTime, ''); hasReadTime = true }
        if (raw.skippedResults) throw new Error('Incomplete inquiry query')
        if (!raw.document) return
        if (++examined > 449) throw new ChannelMetadataWriteFailure(false, tr('{0}을 위해 확인할 소유 문의가 449개를 넘습니다. 일부만 동기화하지 않으며 저장하지 않았습니다.', [label]))
        const doc = document(raw.document)
        childId(doc.name, `${documents}/channelInquiries`)
        if (seen.has(doc.name) || !doc.updateTime || !documentVersion(doc) || stringField(doc.fields, 'channelOwnerId', 160) !== uid) throw new Error('Inquiry identity changed')
        seen.add(doc.name)
        if (stringField(doc.fields, 'channelId', 160) !== edit.channelId || boolField(doc.fields, 'channelDeleted')) return
        writes.push({ update: { name: doc.name, fields: { [isName ? 'channelName' : 'channelPhotoURL']: { stringValue: value } } }, updateMask: { fieldPaths: [isName ? 'channelName' : 'channelPhotoURL'] }, currentDocument: { updateTime: doc.updateTime } })
      })
      if (!hasReadTime) throw new Error('Missing inquiry snapshot')
    }
    current()
    const request = { database, writes }
    if (Buffer.byteLength(JSON.stringify(request)) > 512 * 1024) throw new ChannelMetadataWriteFailure(false, tr('{0}과 관련 정보를 한 번에 저장할 수 없습니다. 저장하지 않았습니다.', [label]))
    if (change.kind === 'apply-photo') await change.beforeCommit()
    current()
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else resolve()
      }
      const cancel = () => { call.cancel(); finish(new Error('Channel metadata commit cancelled')) }
      current(); committing = true
      const call = client.commit(request, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => {
        if (error) { finish(error); return }
        try {
          if (!Array.isArray(response.writeResults) || response.writeResults.length !== writes.length || !response.commitTime) throw new Error('Incomplete channel metadata commit')
          timestamp(response.commitTime, '')
          for (const result of response.writeResults) timestamp(object(object(result).updateTime), '')
          finish()
        } catch (error) { finish(error) }
      })
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
    return writes.length - 1
  } catch (error) {
    if (error instanceof ChannelMetadataWriteFailure) throw error
    const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
    const uncertain = committing && (code === undefined || !definite.has(code))
    throw new ChannelMetadataWriteFailure(uncertain, uncertain ? tr('{0} 결과를 확인하지 못했습니다. 자동 재저장하지 않고 현재 서버 정보를 확인해 주세요.', [label]) : tr('채널이나 관련 정보가 변경되었거나 권한을 확인하지 못했습니다. 저장하지 않았습니다. 최신 정보에서 다시 편집해 주세요.'))
  }
}
