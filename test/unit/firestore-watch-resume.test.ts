import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { FirestoreReader, type ReadCredentials } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// B87: a listen can resume from the resume token of an earlier snapshot and the documents that snapshot had — Firestore
// then sends only what changed since. Anything that goes wrong reads everything again from nothing.
const chatId = 'chat1'
const message = (id: string, seconds: number): FirestoreDocument => ({
  name: `${documents}/chats/${chatId}/messages/${id}`, updateTime: { seconds: String(seconds), nanos: 0 },
  fields: { createdAt: { timestampValue: { seconds: String(seconds), nanos: 0 } }, senderId: { stringValue: 'peer' }, type: { stringValue: 'text' }, text: { stringValue: id } }
} as unknown as FirestoreDocument)
const tick = () => new Promise(resolve => setImmediate(resolve))

// A listen stream as grpc-js hands it over: the reader writes its target and reads document changes back.
class FakeStream extends EventEmitter {
  written: { addTarget?: { resumeToken?: unknown } }[] = []
  write(message: { addTarget?: { resumeToken?: unknown } }): boolean { this.written.push(message); return true }
  cancel(): void {}
}
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
const at = { seconds: '1790121600', nanos: 0 }
function listenReader() {
  const reader = new FirestoreReader(credentials), streams: FakeStream[] = []
  ;(reader as unknown as { client: unknown }).client = { listen: () => { const stream = new FakeStream(); streams.push(stream); return stream }, close: () => {}, getChannel: () => ({ getConnectivityState: () => 2 }) }
  return { reader, streams }
}
const target = { query: { parent: `${documents}/chats/${chatId}`, structuredQuery: { from: [{ collectionId: 'messages' }] } } }

test('a resumed listen sends its token, starts from the documents it had and takes only the changes', async () => {
  const { reader, streams } = listenReader()
  const snapshots: string[][] = [], tokens: string[] = [], states: string[] = []
  const stop = reader.watch(target, new AbortController().signal, {
    snapshot: docs => snapshots.push([...docs.keys()].map(name => name.split('/').at(-1)!)),
    state: state => states.push(state), reconnecting: () => states.push('reconnecting'), resumeToken: token => tokens.push(String(token))
  }, 81, undefined, { token: Buffer.from('t1'), documents: new Map([message('m1', 10), message('m2', 20)].map(doc => [doc.name, doc])) })
  await tick()
  assert.equal(String(streams[0]!.written[0]!.addTarget!.resumeToken), 't1')
  assert.ok(!states.includes('loading'), 'what the chat shows stays while the resumed listen starts')
  streams[0]!.emit('data', { documentChange: { document: message('m3', 30), targetIds: [1] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [], readTime: at, resumeToken: Buffer.from('t2') } })
  assert.deepEqual(snapshots.at(-1)?.sort(), ['m1', 'm2', 'm3'], 'the kept documents and the one change')
  assert.deepEqual(tokens, ['t2'])
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'RESET', targetIds: [1] } })
  streams[0]!.emit('data', { documentChange: { document: message('m9', 90), targetIds: [1] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [], readTime: at } })
  assert.deepEqual(snapshots.at(-1), ['m9'], 'a RESET reads everything again from nothing')
  stop()
})

test('a listen with nothing kept sends no token, and a count that disagrees listens again from nothing', async () => {
  const { reader, streams } = listenReader()
  const stop = reader.watch(target, new AbortController().signal, { snapshot: () => {}, state: () => {} }, 81, undefined,
    { token: 't1', documents: new Map([[message('m1', 10).name, message('m1', 10)]]) })
  await tick()
  streams[0]!.emit('data', { filter: { targetId: 1, count: 5 } })
  await new Promise(resolve => setTimeout(resolve, 1500))
  assert.equal(streams.length, 2, 'listened again')
  assert.equal(streams[1]!.written[0]!.addTarget!.resumeToken, undefined, 'only the first listen resumes')
  stop()
  const plain = listenReader()
  const stopPlain = plain.reader.watch(target, new AbortController().signal, { snapshot: () => {}, state: () => {} }, 81)
  await tick()
  assert.equal(plain.streams[0]!.written[0]!.addTarget!.resumeToken, undefined)
  stopPlain()
})
