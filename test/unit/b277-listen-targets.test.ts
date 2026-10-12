import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { FirestoreReader, type ReadCredentials, type WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// B277 ②: many targets over one Listen stream, each with its own documents, consistency, resume token and refusal.
const story = (owner: string, id: string): FirestoreDocument => ({
  name: `${documents}/users/${owner}/publicStories/${id}`, updateTime: { seconds: '1790121600', nanos: 0 },
  fields: { expiresAt: { timestampValue: { seconds: '1790200000', nanos: 0 } } }
} as unknown as FirestoreDocument)
const tick = () => new Promise(resolve => setImmediate(resolve))
type Written = { addTarget?: { targetId: number; resumeToken?: unknown; query?: { parent: string } }; removeTarget?: number }
class FakeStream extends EventEmitter {
  written: Written[] = []
  cancelled = false
  write(message: Written): boolean { this.written.push(message); return true }
  cancel(): void { this.cancelled = true }
  added(owner: string): Written['addTarget'] { return this.written.filter(item => item.addTarget?.query?.parent.endsWith(`/users/${owner}`)).at(-1)?.addTarget }
}
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
const at = { seconds: '1790121600', nanos: 0 }
function listenReader() {
  const reader = new FirestoreReader(credentials), streams: FakeStream[] = []
  ;(reader as unknown as { client: unknown }).client = { listen: () => { const stream = new FakeStream(); streams.push(stream); return stream }, close: () => {}, getChannel: () => ({ getConnectivityState: () => 2 }) }
  return { reader, streams }
}
const target = (owner: string) => ({ query: { parent: `${documents}/users/${owner}`, structuredQuery: { from: [{ collectionId: 'publicStories' }] } } })
function recorder() {
  const seen = { snapshots: [] as string[][], states: [] as string[], tokens: [] as string[] }
  const events: WatchEvents = {
    snapshot: docs => seen.snapshots.push([...docs.keys()].map(name => name.split('/').at(-1)!).sort()),
    state: (state, error) => seen.states.push(error ? `${state}:${error.code}` : state),
    reconnecting: () => seen.states.push('reconnecting'),
    resumeToken: token => seen.tokens.push(String(token))
  }
  return { seen, events }
}
const consistent = (stream: FakeStream, token?: string) => stream.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [], readTime: at, ...(token ? { resumeToken: Buffer.from(token) } : {}) } })

test('two targets share one stream, and each answers with its own documents and token', async () => {
  const { reader, streams } = listenReader()
  const listen = reader.listenTargets(new AbortController().signal)
  const a = recorder(), b = recorder()
  listen.add(target('a'), a.events, 50)
  listen.add(target('b'), b.events, 50)
  await tick()
  assert.equal(streams.length, 1, 'one stream')
  const ida = streams[0]!.added('a')!.targetId, idb = streams[0]!.added('b')!.targetId
  assert.notEqual(ida, idb)
  streams[0]!.emit('data', { documentChange: { document: story('a', 's1'), targetIds: [ida] } })
  streams[0]!.emit('data', { documentChange: { document: story('b', 's2'), targetIds: [idb] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [ida, idb] } })
  consistent(streams[0]!, 't1')
  assert.deepEqual(a.seen.snapshots, [['s1']])
  assert.deepEqual(b.seen.snapshots, [['s2']])
  assert.deepEqual([a.seen.tokens, b.seen.tokens], [['t1'], ['t1']])
  assert.equal(a.seen.states.at(-1), 'ready')
  assert.deepEqual(listen.tally, { fresh: 2, resumed: 0, documents: 2, refused: 0 })
  listen.close()
  assert.ok(streams[0]!.cancelled)
})

test('the server refusing one target ends that one only', async () => {
  const { reader, streams } = listenReader()
  const listen = reader.listenTargets(new AbortController().signal)
  const a = recorder(), b = recorder()
  listen.add(target('a'), a.events, 50)
  listen.add(target('b'), b.events, 50)
  await tick()
  const ida = streams[0]!.added('a')!.targetId, idb = streams[0]!.added('b')!.targetId
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'REMOVE', targetIds: [ida], cause: { code: 7, message: 'Missing or insufficient permissions.' } } })
  assert.equal(a.seen.states.at(-1), 'error:permission')
  streams[0]!.emit('data', { documentChange: { document: story('b', 's2'), targetIds: [idb] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [idb] } })
  consistent(streams[0]!)
  assert.deepEqual(b.seen.snapshots, [['s2']])
  assert.equal(b.seen.states.at(-1), 'ready')
  assert.equal(streams.length, 1, 'the stream stays')
  assert.ok(!streams[0]!.cancelled)
  assert.equal(listen.size, 1)
  assert.equal(listen.tally.refused, 1)
  assert.ok(!streams[0]!.written.some(item => item.removeTarget === ida), 'the server removed it already')
  listen.close()
})

test('a dropped stream listens again, each target from its own token and documents; one never current from nothing', async () => {
  const { reader, streams } = listenReader()
  const listen = reader.listenTargets(new AbortController().signal)
  const a = recorder(), b = recorder()
  listen.add(target('a'), a.events, 50)
  listen.add(target('b'), b.events, 50)
  await tick()
  const ida = streams[0]!.added('a')!.targetId
  streams[0]!.emit('data', { documentChange: { document: story('a', 's1'), targetIds: [ida] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [ida] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [ida], readTime: at, resumeToken: Buffer.from('ta') } })
  streams[0]!.emit('end')
  assert.equal(a.seen.states.at(-1), 'reconnecting', 'what a target showed stays')
  assert.equal(b.seen.states.at(-1), 'loading:network')
  reader.reconnectNow()
  await tick()
  assert.equal(streams.length, 2)
  assert.equal(String(streams[1]!.added('a')!.resumeToken), 'ta')
  assert.equal(streams[1]!.added('b')!.resumeToken, undefined)
  const next = streams[1]!.added('a')!.targetId
  streams[1]!.emit('data', { documentChange: { document: story('a', 's3'), targetIds: [next] } })
  streams[1]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [next] } })
  consistent(streams[1]!)
  assert.deepEqual(a.seen.snapshots.at(-1), ['s1', 's3'], 'the kept document and the change')
  assert.deepEqual(listen.tally, { fresh: 3, resumed: 1, documents: 2, refused: 0 })
  listen.close()
})

test('a count that disagrees reads that target again from nothing, and the others are left as they are', async () => {
  const { reader, streams } = listenReader()
  const listen = reader.listenTargets(new AbortController().signal)
  const a = recorder(), b = recorder()
  listen.add(target('a'), a.events, 50)
  listen.add(target('b'), b.events, 50)
  await tick()
  const ida = streams[0]!.added('a')!.targetId, idb = streams[0]!.added('b')!.targetId
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [ida, idb] } })
  consistent(streams[0]!, 't1')
  const writes = streams[0]!.written.length
  streams[0]!.emit('data', { filter: { targetId: ida, count: 3 } })
  const after = streams[0]!.written.slice(writes)
  assert.deepEqual(after[0], { database: after[0] && (after[0] as { database?: string }).database, removeTarget: ida })
  assert.equal(after[1]!.addTarget!.resumeToken, undefined, 'from nothing')
  assert.ok(after[1]!.addTarget!.targetId > idb, 'under a new id')
  assert.equal(after.length, 2, 'b is not listened again')
  // A late message for the earlier id finds nothing.
  streams[0]!.emit('data', { documentChange: { document: story('a', 'late'), targetIds: [ida] } })
  streams[0]!.emit('data', { documentChange: { document: story('a', 's1'), targetIds: [after[1]!.addTarget!.targetId] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [after[1]!.addTarget!.targetId] } })
  consistent(streams[0]!)
  assert.deepEqual(a.seen.snapshots.at(-1), ['s1'])
  assert.equal(streams.length, 1)
  listen.close()
})

test('removing targets writes their removal; the last one closes the stream and the next opens it again', async () => {
  const { reader, streams } = listenReader()
  const listen = reader.listenTargets(new AbortController().signal)
  const stopA = listen.add(target('a'), recorder().events, 50)
  const stopB = listen.add(target('b'), recorder().events, 50)
  await tick()
  const ida = streams[0]!.added('a')!.targetId
  stopA()
  assert.equal(streams[0]!.written.at(-1)!.removeTarget, ida)
  assert.ok(!streams[0]!.cancelled)
  stopB()
  assert.ok(streams[0]!.cancelled, 'nothing left to listen to')
  listen.add(target('c'), recorder().events, 50)
  await tick()
  assert.equal(streams.length, 2)
  assert.ok(streams[1]!.added('c'))
  listen.close()
})

test('a paused reader rests the stream and tells nothing; resumed, each target listens from its token', async () => {
  const { reader, streams } = listenReader()
  const listen = reader.listenTargets(new AbortController().signal)
  const a = recorder()
  listen.add(target('a'), a.events, 50)
  await tick()
  const ida = streams[0]!.added('a')!.targetId
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [ida] } })
  consistent(streams[0]!, 'ta')
  const states = a.seen.states.length
  reader.pause()
  assert.ok(streams[0]!.cancelled)
  assert.equal(a.seen.states.length, states, 'nothing told while resting')
  reader.resume()
  await tick()
  assert.equal(streams.length, 2)
  assert.equal(String(streams[1]!.added('a')!.resumeToken), 'ta')
  assert.equal(a.seen.states.at(-1), 'reconnecting')
  listen.close()
})

test('more documents than a target allows ends that target at the consistent point', async () => {
  const { reader, streams } = listenReader()
  const listen = reader.listenTargets(new AbortController().signal)
  const a = recorder(), b = recorder()
  listen.add(target('a'), a.events, 1)
  listen.add(target('b'), b.events, 50)
  await tick()
  const ida = streams[0]!.added('a')!.targetId, idb = streams[0]!.added('b')!.targetId
  streams[0]!.emit('data', { documentChange: { document: story('a', 's1'), targetIds: [ida] } })
  streams[0]!.emit('data', { documentChange: { document: story('a', 's2'), targetIds: [ida] } })
  streams[0]!.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [ida, idb] } })
  consistent(streams[0]!)
  assert.equal(a.seen.states.at(-1), 'error:data')
  assert.equal(streams[0]!.written.at(-1)!.removeTarget, ida)
  assert.equal(b.seen.states.at(-1), 'ready')
  listen.close()
})
