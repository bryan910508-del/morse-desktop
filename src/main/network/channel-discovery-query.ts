import type { ClientReadableStream, Metadata, ServiceError } from '@grpc/grpc-js'
import { status } from '@grpc/grpc-js'
import { document, documents, ReadFailure, timestamp, type FirestoreDocument, type WireObject } from './firestore-values'
import { object } from '../../shared/validation'
export interface DiscoveryQuery { query: string; tag: string | null }
interface QueryClient { runQuery(request: WireObject, metadata: Metadata, options: { deadline: Date }): ClientReadableStream<WireObject> }
export async function queryPublicChannels(client: QueryClient, auth: Metadata, query: DiscoveryQuery, kind: 'name' | 'tag', signal: AbortSignal, validate: () => void): Promise<FirestoreDocument[]> {
  signal.throwIfAborted(); validate()
  const filter = (path: string, op: string, value: WireObject): WireObject => ({ fieldFilter: { field: { fieldPath: path }, op, value } })
  if (kind === 'tag' && !query.tag) throw new ReadFailure('data')
  const filters = [filter('isPublic', 'EQUAL', { booleanValue: true }), ...(kind === 'name' ? [filter('name', 'GREATER_THAN_OR_EQUAL', { stringValue: query.query }), filter('name', 'LESS_THAN_OR_EQUAL', { stringValue: query.query + '\uf8ff' })] : [filter('tags', 'ARRAY_CONTAINS', { stringValue: query.tag! })])]
  const structuredQuery: WireObject = { from: [{ collectionId: 'channels' }], where: { compositeFilter: { op: 'AND', filters } }, limit: { value: 21 } }
  if (kind === 'name') structuredQuery.orderBy = [{ field: { fieldPath: 'name' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }]
  return new Promise((resolve, reject) => {
    let settled = false, bytes = 0, readTime = false
    const rows: FirestoreDocument[] = [], seen = new Set<string>()
    const finish = (error?: unknown): void => {
      if (settled) return
      settled = true; signal.removeEventListener('abort', cancel)
      if (error) { stream.cancel(); reject(error); return }
      try { signal.throwIfAborted(); validate(); if (!readTime) throw new ReadFailure('data'); resolve(rows) } catch (e) { reject(e) }
    }
    const cancel = (): void => finish(new ReadFailure('cancelled'))
    const stream = client.runQuery({ parent: documents, structuredQuery }, auth, { deadline: new Date(Date.now() + 30000) })
    signal.addEventListener('abort', cancel, { once: true })
    stream.on('data', (raw: WireObject) => {
      if (settled) return
      try {
        signal.throwIfAborted(); validate()
        if (raw.readTime) { timestamp(object(raw.readTime), ''); readTime = true }
        if (raw.document) {
          bytes += Buffer.byteLength(JSON.stringify(raw.document), 'utf8')
          if (rows.length >= 21 || bytes > 4 * 1024 * 1024) throw new ReadFailure('data')
          const doc = document(raw.document)
          if (seen.has(doc.name)) throw new ReadFailure('data')
          seen.add(doc.name); rows.push(doc)
        }
      } catch (error) { finish(error) }
    })
    stream.on('error', (error: ServiceError) => finish(new ReadFailure(error.code === status.FAILED_PRECONDITION ? 'index' : [status.PERMISSION_DENIED, status.UNAUTHENTICATED].includes(error.code) ? 'permission' : 'network')))
    stream.on('end', () => finish())
    if (signal.aborted) cancel()
  })
}
