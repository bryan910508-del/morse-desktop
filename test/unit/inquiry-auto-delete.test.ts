import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { inquiryAutoDeleteRequest } from '../../src/shared/channel-inquiries'
import { autoDeleteChoices } from '../../src/shared/chat-auto-delete'
import { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents } from '../../src/main/network/firestore-values'

// The room's auto-delete policy is the one a chat keeps (AppState.updateChatAutoDeletePolicy), on
// channelInquiries/{id}. firestore.rules autoDeletePolicyActorOk refuses a change that does not name its actor.
interface CommitRequest { database: string; writes: { update?: { name: string; fields: Record<string, { integerValue?: string; booleanValue?: boolean; stringValue?: string }> }
  updateMask?: { fieldPaths: string[] }; currentDocument?: { exists?: boolean } }[] }

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

test('only the durations the server accepts are asked for, and «내 메시지만» needs the policy on', () => {
  const requestId = randomUUID(), inquiryId = 'ch1_sub1'
  for (const seconds of autoDeleteChoices) {
    assert.deepEqual(inquiryAutoDeleteRequest({ requestId, inquiryId, seconds, myOnly: false }), { requestId, inquiryId, seconds, myOnly: false })
  }
  assert.deepEqual(inquiryAutoDeleteRequest({ requestId, inquiryId, seconds: 604800, myOnly: true }), { requestId, inquiryId, seconds: 604800, myOnly: true })
  assert.deepEqual(inquiryAutoDeleteRequest({ requestId, inquiryId, seconds: 0, myOnly: true }), { requestId, inquiryId, seconds: 0, myOnly: false }, 'off applies to nobody')
  assert.throws(() => inquiryAutoDeleteRequest({ requestId, inquiryId, seconds: 7200, myOnly: false }), /자동 삭제/)
  assert.throws(() => inquiryAutoDeleteRequest({ requestId, inquiryId, seconds: '604800', myOnly: false }), /자동 삭제/)
  assert.throws(() => inquiryAutoDeleteRequest({ requestId, inquiryId, seconds: 604800 }), /자동 삭제/)
  assert.throws(() => inquiryAutoDeleteRequest({ requestId, inquiryId, seconds: 604800, myOnly: false, extra: 1 }))
})

test('the policy is written on the room with its actor, and serializes for Firestore', async () => {
  const { reader, sent } = stubbedReader()
  await reader.setInquiryAutoDelete('me1', 'ch1_sub1', 86400, true, new AbortController().signal)
  const write = sent()?.writes[0]
  assert.equal(write?.update?.name, `${documents}/channelInquiries/ch1_sub1`)
  assert.equal(write?.update?.fields.autoDeleteSeconds?.integerValue, '86400')
  assert.equal(write?.update?.fields.autoDeleteMyOnly?.booleanValue, true)
  assert.equal(write?.update?.fields.autoDeleteLastSetByUid?.stringValue, 'me1', 'without the actor the rules refuse the change')
  assert.deepEqual(write?.updateMask?.fieldPaths, ['autoDeleteSeconds', 'autoDeleteMyOnly', 'autoDeleteLastSetByUid'], 'nothing else of the room is touched')
  assert.equal(write?.currentDocument?.exists, true, 'a room that is gone is never created by a policy change')
  const definition = fromJSON(JSON.parse(readFileSync(join(process.cwd(), 'resources/firestore-v1.json'), 'utf8')),
    { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
  const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer }>
  const commit = service[Object.keys(service).find(name => name.toLowerCase() === 'commit')!]!
  assert.ok(commit.requestSerialize(sent()).length > 0)
})
