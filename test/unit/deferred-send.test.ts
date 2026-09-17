import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { deferredFields } from '../../src/main/accounts/deferred-messages'
import type { DeferredSendRequest } from '../../src/shared/deferred-send'

// The same descriptor and options the FirestoreReader constructor loads, so these tests serialize a
// queued send exactly the way the running app does.
const definition = fromJSON(JSON.parse(readFileSync(join(process.cwd(), 'resources/firestore-v1.json'), 'utf8')),
  { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer; requestDeserialize(value: Buffer): unknown }>
const commit = service[Object.keys(service).find(name => name.toLowerCase() === 'commit')!]!
const database = 'projects/p/databases/(default)'
const commitRequest = (fields: Record<string, unknown>): unknown => ({ database, writes: [{
  update: { name: `${database}/documents/scheduledMessages/M1`, fields }, currentDocument: { exists: false },
  updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }] }] })
const at = Date.UTC(2026, 8, 16, 1, 0, 0)
const request: DeferredSendRequest = { chatId: 'chat1', messageId: 'M1', kind: 'scheduled', text: 'hello', scheduledAt: at, silent: false, reply: null }
const writtenTime = (payload: unknown): { seconds?: string; nanos?: number } | undefined => {
  const value = payload as { writes: { update: { fields: { scheduledAt?: { timestampValue?: { seconds?: string; nanos?: number } } } } }[] }
  return value.writes[0]!.update.fields.scheduledAt?.timestampValue
}

test('a scheduled send keeps its time through the commit call', () => {
  const encoded = commit.requestSerialize(commitRequest(deferredFields(request, 'me', 'hello', '')))
  assert.ok(encoded.length > 0)
  assert.equal(writtenTime(commit.requestDeserialize(encoded))?.seconds, String(at / 1000))
})

test('an ISO string queue time does not reach the server as that time', () => {
  const fields = { ...deferredFields(request, 'me', 'hello', ''), scheduledAt: { timestampValue: new Date(at).toISOString() } }
  let sent: { seconds?: string } | undefined
  try { sent = writtenTime(commit.requestDeserialize(commit.requestSerialize(commitRequest(fields)))) }
  catch (error) { assert.ok(error instanceof Error); return }
  // No error: the string is dropped, so the queued message would carry the wrong time instead.
  assert.notEqual(sent?.seconds, String(at / 1000))
})
