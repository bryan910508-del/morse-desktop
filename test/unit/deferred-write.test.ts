import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fromJSON } from '@grpc/proto-loader'
import { deferredFields } from '../../src/main/accounts/deferred-messages'
import { FirestoreReader } from '../../src/main/network/firestore-rpc'
import { documents } from '../../src/main/network/firestore-values'
import type { DeferredSendRequest } from '../../src/shared/deferred-send'

// What the queue write must look like on the wire: the whole commit is captured from a stubbed
// client and then serialized with the descriptor the real client loads.
const at = Date.UTC(2026, 8, 16, 1, 0, 0)
const request: DeferredSendRequest = { chatId: 'chat1', messageId: 'M1', kind: 'scheduled', text: 'hello', scheduledAt: at, silent: false, reply: null }
interface CommitRequest { database: string; writes: { update: { name: string; fields: Record<string, { stringValue?: string; timestampValue?: { seconds?: string; nanos?: number } }> }; currentDocument?: { exists?: boolean }; updateTransforms?: { fieldPath: string; setToServerValue?: string }[] }[] }

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

test('a scheduled send is created once, at the chosen second', async () => {
  const { reader, sent } = stubbedReader()
  await reader.createDeferredMessage('scheduledMessages', request.messageId, deferredFields(request, 'me', 'hello', ''), new AbortController().signal)
  const write = sent()?.writes[0]
  assert.equal(write?.update.name, `${documents}/scheduledMessages/M1`)
  assert.equal(write?.currentDocument?.exists, false, 'the document is created, never overwritten')
  assert.equal(write?.updateTransforms?.[0]?.fieldPath, 'createdAt')
  assert.equal(write?.update.fields.scheduledAt?.timestampValue?.seconds, String(at / 1000))
  assert.equal(write?.update.fields.status?.stringValue, 'pending')
})

test('the captured commit serializes for the real Firestore service', async () => {
  const { reader, sent } = stubbedReader()
  await reader.createDeferredMessage('scheduledMessages', request.messageId, deferredFields(request, 'me', 'hello', ''), new AbortController().signal)
  const definition = fromJSON(JSON.parse(readFileSync(join(process.cwd(), 'resources/firestore-v1.json'), 'utf8')),
    { longs: String, enums: String, bytes: Buffer, defaults: false, oneofs: true })
  const service = definition['google.firestore.v1.Firestore'] as unknown as Record<string, { requestSerialize(value: unknown): Buffer }>
  const commit = service[Object.keys(service).find(name => name.toLowerCase() === 'commit')!]!
  assert.ok(commit.requestSerialize(sent()).length > 0)
})
