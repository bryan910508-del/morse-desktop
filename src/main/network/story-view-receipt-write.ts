import type { ClientReadableStream, ClientUnaryCall, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { object } from '../../shared/validation'
import { storyViewReceiptRequest, type StoryViewReceiptRequest } from '../../shared/story-view-receipt'
import { positionMilliseconds } from '../../shared/model'
import { database, document, documents, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { ownStoryCollections, ownStoryFromDocument } from './own-story-document'
import { storyHiddenFrom } from './story-hidden-audience'
import { currentViewerRecord } from './contact-story-view-record'
import { tr } from '../../shared/i18n'
export class StoryViewReceiptWriteFailure extends Error { constructor(readonly uncertain: boolean) { super(uncertain ? tr('열람 기록 결과 미확인') : tr('열람 기록을 시작하지 못했거나 서버가 거절했습니다.')) } }
interface TransactionClient {
  beginTransaction(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
  batchGetDocuments(request: WireObject, metadata: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject>
  commit(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
  rollback(request: WireObject, metadata: Metadata, options: { deadline: Date }, callback: (error: ServiceError | null, response: WireObject) => void): ClientUnaryCall
}
const definite = new Set([status.ABORTED, status.ALREADY_EXISTS, status.PERMISSION_DENIED, status.UNAUTHENTICATED, status.FAILED_PRECONDITION, status.INVALID_ARGUMENT, status.NOT_FOUND])
export async function writeStoryViewReceipt(client: TransactionClient, auth: Metadata, uid: string, input: StoryViewReceiptRequest, signal: AbortSignal, validate: () => void): Promise<void> {
  const request = storyViewReceiptRequest(input)
  const storyPath = `${documents}/users/${request.ownerId}/${ownStoryCollections[request.privacy]}/${request.storyId}`
  const audiencePath = request.privacy === 'everyone' ? null : `${documents}/users/${request.ownerId}/${request.privacy === 'contacts' ? 'contacts' : 'closeFriends'}/${uid}`
  const paths = audiencePath ? [storyPath, audiencePath] : [storyPath]
  let transaction: Buffer | null = null, committing = false, committed = false
  const unary = (method: 'beginTransaction' | 'commit', request: WireObject): Promise<WireObject> => {
    signal.throwIfAborted(); validate()
    return new Promise((done, reject) => {
      let settled = false
      const finish = (error: unknown, response?: WireObject): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) reject(error); else done(response!)
      }
      const cancel = (): void => { call.cancel(); finish(new Error('View receipt operation cancelled')) }
      const call = client[method](request, auth, { deadline: new Date(Date.now() + 30000) }, (error, response) => finish(error, response))
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
  }
  try {
    signal.throwIfAborted(); validate(); if (request.viewerId !== uid || request.ownerId === uid) throw new Error('Viewer identity mismatch')
    const started = await unary('beginTransaction', { database, options: { readWrite: {} } })
    if (!Buffer.isBuffer(started.transaction) || !started.transaction.length || started.transaction.length > 4096) throw new Error('Invalid transaction identity')
    transaction = started.transaction
    const rows = await new Promise<Map<string, FirestoreDocument | null>>((done, reject) => {
      const result = new Map<string, FirestoreDocument | null>()
      let settled = false, bytes = 0
      const finish = (error?: unknown): void => {
        if (settled) return
        settled = true; signal.removeEventListener('abort', cancel)
        if (error) { call.cancel(); reject(error) } else done(result)
      }
      const cancel = (): void => finish(new Error('View receipt lookup cancelled'))
      const call = client.batchGetDocuments({ database, documents: paths, transaction }, auth, { deadline: new Date(Date.now() + 30000) })
      call.on('data', (raw: WireObject) => {
        if (settled) return
        try {
          signal.throwIfAborted(); validate(); bytes += Buffer.byteLength(JSON.stringify(raw))
          if (bytes > 4 * 1024 * 1024) throw new Error('View receipt lookup too large')
          if ((raw.found === undefined) === (raw.missing === undefined)) throw new Error('Invalid transaction document result')
          const doc = raw.found !== undefined ? document(raw.found) : null
          const path = doc?.name ?? raw.missing
          if (typeof path !== 'string' || !paths.includes(path) || result.has(path)) throw new Error('View receipt lookup scope mismatch')
          result.set(path, doc)
        } catch (error) { finish(error) }
      })
      call.on('error', finish)
      call.on('end', () => finish(result.size === paths.length ? undefined : new Error('Incomplete view receipt lookup')))
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel()
    })
    signal.throwIfAborted()
    validate()
    const story = rows.get(storyPath)
    if (!story || (audiencePath && !rows.get(audiencePath))) throw new Error('Story or current audience missing')
    const current = ownStoryFromDocument(story, request.ownerId, request.privacy)
    const prior = currentViewerRecord(story, uid, true)
    if (!story.updateTime || current.version !== request.version || positionMilliseconds(current.expires) !== request.expiresAt || request.expiresAt <= Date.now() || storyHiddenFrom(story).hiddenFrom.includes(uid) || prior.listed || prior.viewerFieldPresent !== request.viewerFieldPresent || prior.timeField !== request.originalTimeField || prior.viewedAt !== request.originalViewedAt) throw new Error('Story or original view record changed')
    const ownTimeField = `viewedAtByUid.\`${uid}\``
    signal.throwIfAborted(); validate()
    committing = true
    const result = await unary('commit', { database, transaction, writes: [{ transform: { document: storyPath, fieldTransforms: [
      { fieldPath: 'viewerIds', appendMissingElements: { values: [{ stringValue: uid }] } },
      { fieldPath: ownTimeField, setToServerValue: 'REQUEST_TIME' }
    ] }, currentDocument: { updateTime: story.updateTime } }] })
    if (!Array.isArray(result.writeResults) || result.writeResults.length !== 1 || !result.commitTime) throw new Error('Incomplete view receipt commit')
    timestamp(result.commitTime, ''); const written = object(result.writeResults[0]); timestamp(object(written.updateTime), '')
    if (!Array.isArray(written.transformResults) || written.transformResults.length !== 2 || object(written.transformResults[0]).nullValue !== 'NULL_VALUE') throw new Error('Incomplete view receipt transforms')
    timestamp(object(written.transformResults[1]).timestampValue, uid)
    committed = true
  } catch (error) {
    if (error instanceof StoryViewReceiptWriteFailure) throw error
    const code = error && typeof error === 'object' ? (error as { code?: number }).code : undefined
    throw new StoryViewReceiptWriteFailure(committing && (code === undefined || !definite.has(code)))
  } finally {
    // Rollback is bounded cleanup, never evidence that an uncertain commit failed.
    if (transaction && !committed) await new Promise<void>(done => {
      try { client.rollback({ database, transaction }, auth, { deadline: new Date(Date.now() + 5000) }, () => done()) } catch { done() }
    })
  }
}
