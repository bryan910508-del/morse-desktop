import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { ChatTyping, typingTarget } from '../../src/main/accounts/chat-typing'
import { dialogStateQuery } from '../../src/main/accounts/dialog-pins'
import { documents } from '../../src/main/network/firestore-values'
import type { FirestoreReader } from '../../src/main/network/firestore-rpc'

// B20 (2026-10-01): StructuredQuery.limit is a google.protobuf.Int32Value. Sent as a bare number it fails to serialize
// («StructuredQuery.limit: object expected») before the request leaves, and the read is retried as INTERNAL for ever:
// every group room's «입력 중…» read since e861f79, and the read-back of a pin whose answer was lost.
const definition = fromJSON(JSON.parse(readFileSync(join(process.cwd(), 'resources/firestore-v1.json'), 'utf8')), { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer; requestDeserialize(value: Buffer): any }>
const method = (name: string) => service[Object.keys(service).find(key => key.toLowerCase() === name)!]!
const database = documents.slice(0, -'/documents'.length)

test('a bare number limit does not serialize; { value } does', () => {
  const listen = method('listen')
  const query = { parent: `${documents}/chats/c1`, structuredQuery: { from: [{ collectionId: 'watchers' }], limit: 500 } }
  assert.throws(() => listen.requestSerialize({ database, addTarget: { query, targetId: 1 } }), /limit: object expected/)
})

test('a group room\'s typing read serializes, with its limit', () => {
  const listen = method('listen'), group = typingTarget('c1', null)
  const sent = listen.requestDeserialize(listen.requestSerialize({ database, addTarget: { ...group, targetId: 1 } }))
  assert.equal(sent.addTarget.query.structuredQuery.limit.value, 500)
  assert.equal(sent.addTarget.query.structuredQuery.from[0].collectionId, 'watchers')
  const direct = listen.requestDeserialize(listen.requestSerialize({ database, addTarget: { ...typingTarget('c1', 'peer'), targetId: 2 } }))
  assert.deepEqual(direct.addTarget.documents.documents, [`${documents}/chats/c1/watchers/peer`], 'a 1:1 room reads the other person\'s document')
  // What ChatTyping hands the reader is that target.
  let watched: unknown = null
  const typing = new ChatTyping('me', new AbortController().signal, () => {})
  typing.bind('c1', null, { watch: (target: unknown) => { watched = target; return () => {} } } as unknown as FirestoreReader)
  assert.deepEqual(watched, group)
  typing.clear()
})

test('the read-back of a pin serializes, with its limit', () => {
  const run = method('runquery'), path = `${documents}/users/me/dialogStates/c1`
  const sent = run.requestDeserialize(run.requestSerialize({ parent: `${documents}/users/me`, structuredQuery: dialogStateQuery(path) }))
  assert.equal(sent.structuredQuery.limit.value, 2)
  assert.equal(sent.structuredQuery.where.fieldFilter.value.referenceValue, path)
})
