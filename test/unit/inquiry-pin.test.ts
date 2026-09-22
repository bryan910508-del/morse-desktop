import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { inquiryPinRequest } from '../../src/shared/channel-inquiries'
import { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents, pinnedMessageIds } from '../../src/main/network/firestore-values'

// «모두에게 고정» in an inquiry room writes the field a chat keeps (AppState.pinMessageForAll):
// channelInquiries/{id}.pinnedForAllMessageIds, changed with appendMissingElements / removeAllFromArray.
interface CommitRequest { database: string; writes: { update?: { name: string }; updateMask?: { fieldPaths: string[] }; currentDocument?: { exists?: boolean }
  updateTransforms?: { fieldPath: string; appendMissingElements?: { values: { stringValue?: string }[] }; removeAllFromArray?: { values: { stringValue?: string }[] } }[] }[] }

function stubbedReader(): { reader: FirestoreReader; sent: () => CommitRequest | undefined } {
  const credentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'token', appCheckToken: 'check' }) }
  const reader = new FirestoreReader(credentials as never)
  let captured: CommitRequest | undefined
  ;(reader as unknown as { client: unknown }).client = {
    commit: (payload: CommitRequest, _metadata: unknown, _options: unknown, callback: (error: unknown, response: unknown) => void) => {
      captured = payload
      callback(null, { writeResults: [{}], commitTime: { seconds: '1', nanos: 0 } })
      return { cancel: () => {} }
    }
  }
  return { reader, sent: () => captured }
}

test('a pin request names one message of one room and says which way', () => {
  const requestId = randomUUID()
  assert.deepEqual(inquiryPinRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', pinned: true }), { requestId, inquiryId: 'ch1_sub1', messageId: 'm1', pinned: true })
  assert.throws(() => inquiryPinRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1' }), /고정/)
  assert.throws(() => inquiryPinRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', pinned: 'yes' }), /고정/)
  assert.throws(() => inquiryPinRequest({ requestId, inquiryId: 'ch1_sub1', messageId: 'm1', pinned: true, extra: 1 }))
})

test('the room keeps the pinned ids, and unreadable entries are left out', () => {
  assert.deepEqual(pinnedMessageIds({ pinnedForAllMessageIds: { arrayValue: { values: [{ stringValue: 'm1' }, { stringValue: 'm2' }, { stringValue: 'm1' }] } } }), ['m1', 'm2'])
  assert.deepEqual(pinnedMessageIds({ pinnedForAllMessageIds: { arrayValue: { values: [{ stringValue: 'm1' }, { integerValue: '3' }, { stringValue: 'bad/id' }] } } }), ['m1'])
  assert.deepEqual(pinnedMessageIds({}), [])
})

test('pinning and unpinning change only that array, on an existing room, and serialize for Firestore', async () => {
  for (const pinned of [true, false]) {
    const { reader, sent } = stubbedReader()
    await reader.setInquiryPinnedForAll('ch1_sub1', 'm1', pinned, new AbortController().signal)
    const write = sent()?.writes[0]
    assert.equal(write?.update?.name, `${documents}/channelInquiries/ch1_sub1`)
    assert.deepEqual(write?.updateMask?.fieldPaths, [], 'no field of the room is overwritten')
    assert.equal(write?.currentDocument?.exists, true, 'a room that is gone is never created by a pin')
    const transform = write?.updateTransforms?.[0]
    assert.equal(transform?.fieldPath, 'pinnedForAllMessageIds')
    assert.deepEqual((pinned ? transform?.appendMissingElements : transform?.removeAllFromArray)?.values, [{ stringValue: 'm1' }])
    assert.equal(pinned ? transform?.removeAllFromArray : transform?.appendMissingElements, undefined)
    const definition = fromJSON(JSON.parse(readFileSync(join(process.cwd(), 'resources/firestore-v1.json'), 'utf8')),
      { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
    const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer }>
    const commit = service[Object.keys(service).find(name => name.toLowerCase() === 'commit')!]!
    assert.ok(commit.requestSerialize(sent()).length > 0)
  }
})
