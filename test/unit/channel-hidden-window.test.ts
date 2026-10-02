import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { after, before, test } from 'node:test'
import { ChannelsSession } from '../../src/main/accounts/channels'
import { channelPostRevision } from '../../src/main/media/channel-post-media-document'
import { FirestoreReader, type ReadCredentials, type WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// Telegram Desktop keeps a channel's loaded posts and replies while its window is hidden. Desktop stops the channel
// reads while no channel surface is seen, and now keeps what they showed: the reader's watches rest, and listen again as
// after a reconnect once the window is seen again.
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
const at = { seconds: '1790121600', nanos: 0 }
const uid = 'me', root = `${documents}/channels/ch-a`
const channel = { name: root, updateTime: at, fields: { ownerId: { stringValue: uid }, name: { stringValue: '채널' }, createdAt: { timestampValue: at } } } as unknown as FirestoreDocument
const post = (id: string): FirestoreDocument => ({ name: `${root}/posts/${id}`, updateTime: at, fields: { channelId: { stringValue: 'ch-a' }, authorId: { stringValue: uid },
  text: { stringValue: id }, visibility: { stringValue: 'public' }, createdAt: { timestampValue: at }, likedBy: { arrayValue: { values: [] } }, likeCount: { integerValue: '0' }, commentCount: { integerValue: '1' } } }) as unknown as FirestoreDocument
const comment = (postId: string, id: string): FirestoreDocument => ({ name: `${root}/posts/${postId}/comments/${id}`, updateTime: at, fields: { channelId: { stringValue: 'ch-a' }, postId: { stringValue: postId },
  authorId: { stringValue: 'other' }, authorName: { stringValue: '다른 사람' }, text: { stringValue: '댓글' }, createdAt: { timestampValue: at } } }) as unknown as FirestoreDocument

// A listen stream as grpc-js hands it over: the reader writes its target and reads document changes back.
class FakeStream extends EventEmitter {
  cancelled = false
  write(): boolean { return true }
  cancel(): void { this.cancelled = true }
  current(docs: FirestoreDocument[]): void {
    for (const doc of docs) this.emit('data', { documentChange: { document: doc, targetIds: [1] } })
    this.emit('data', { targetChange: { targetChangeType: 'CURRENT', targetIds: [1] } })
    this.emit('data', { targetChange: { targetChangeType: 'NO_CHANGE', targetIds: [], readTime: at } })
  }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const realWatch = FirestoreReader.prototype.watch

test('a resting reader stops listening and tells its watches nothing, then listens again as after a reconnect', async () => {
  const reader = new FirestoreReader(credentials), streams: FakeStream[] = []
  ;(reader as unknown as { client: unknown }).client = { listen: () => { const stream = new FakeStream(); streams.push(stream); return stream }, close: () => {}, getChannel: () => ({ getConnectivityState: () => 2 }) }
  const told: string[] = []
  const events: WatchEvents = { snapshot: rows => told.push(`snapshot ${rows.size}`), state: state => told.push(state), reconnecting: () => told.push('reconnecting') }
  const stop = realWatch.call(reader, { documents: { documents: [root] } }, new AbortController().signal, events, 10)
  await tick()
  streams[0]!.current([channel])
  assert.deepEqual(told, ['loading', 'snapshot 1', 'ready'])
  told.length = 0
  reader.pause()
  assert.equal(reader.paused, true)
  assert.equal(streams[0]!.cancelled, true, 'the stream is closed while nothing is seen')
  assert.deepEqual(told, [], 'the watcher keeps what it shows')
  const late: string[] = []
  const stopLate = realWatch.call(reader, { documents: { documents: [`${root}/admins/${uid}`] } }, new AbortController().signal, { snapshot: () => late.push('snapshot'), state: state => late.push(state) }, 10)
  await tick()
  assert.equal(streams.length, 1, 'a watch started while resting waits too')
  reader.resume()
  await tick()
  assert.equal(reader.paused, false)
  assert.equal(streams.length, 3, 'both listen once more')
  assert.deepEqual(told, ['reconnecting'], 'a watch that was current keeps its snapshot until the next one')
  assert.deepEqual(late, ['loading'])
  streams[1]!.current([channel])
  assert.deepEqual(told, ['reconnecting', 'snapshot 1', 'ready'])
  stop(); stopLate(); reader.close()
})

// The channel list, the open channel's posts and a post's comments, as ChannelsSession reads them, with every watch
// recorded instead of opened; the reader's own pause and resume are the real ones.
interface Recorded { target: { query?: { parent?: string; structuredQuery?: { from?: { collectionId: string }[] } }; documents?: { documents: string[] } }; events: WatchEvents; stopped: boolean }
const recorded: Recorded[] = []
before(() => {
  FirestoreReader.prototype.watch = function (target: unknown, _signal: AbortSignal, events: WatchEvents) {
    const watch: Recorded = { target: target as Recorded['target'], events, stopped: false }
    recorded.push(watch)
    return () => { watch.stopped = true }
  } as typeof FirestoreReader.prototype.watch
})
after(() => { FirestoreReader.prototype.watch = realWatch })
const last = (match: (watch: Recorded) => boolean): Recorded => { const found = recorded.filter(match).pop(); assert.ok(found, 'watch opened'); return found }
const listOf = (collection: string) => (watch: Recorded) => watch.target.query?.structuredQuery?.from?.[0]?.collectionId === collection && watch.target.query.parent !== root
function readList(): void {
  last(listOf('subscriptions')).events.snapshot(new Map())
  last(listOf('channels')).events.snapshot(new Map([[root, channel]]))
}
function readPosts(): void {
  last(watch => Boolean(watch.target.documents?.documents.includes(root))).events.snapshot(new Map([[root, channel]]))
  last(watch => watch.target.query?.parent === root).events.snapshot(new Map([[`${root}/posts/p1`, post('p1')], [`${root}/posts/p2`, post('p2')]]))
}

test('a hidden window keeps the channel list, the open channel and its comments, and shown again they carry on', () => {
  const session = new ChannelsSession(uid, credentials, () => {})
  session.connection(true)
  session.setVisible(true)
  readList()
  assert.equal(session.snapshot.status, 'ready')
  session.posts.open({ requestId: 'r1', channelId: 'ch-a' })
  readPosts()
  session.posts.comments.open({ selectionId: 's1', requestId: 'r1', channelId: 'ch-a', postId: 'p1', revision: channelPostRevision(post('p1')) })
  last(watch => watch.target.query?.parent === `${root}/posts/p1`).events.snapshot(new Map([[`${root}/posts/p1/comments/c1`, comment('p1', 'c1')]]))
  const opened = recorded.length
  const shown = () => { const value = session.snapshot; return [value.status, value.items.length, value.posts?.status, value.posts?.posts.length, value.posts?.comments?.status, value.posts?.comments?.items.length] }
  assert.deepEqual(shown(), ['ready', 1, 'ready', 2, 'ready', 1])

  session.setVisible(false, true)
  const reader = (session as unknown as { reader: FirestoreReader }).reader
  assert.equal(reader.paused, true, 'the reads rest while the window is hidden')
  assert.deepEqual(shown(), ['ready', 1, 'ready', 2, 'ready', 1], 'what was shown stays')
  assert.ok(recorded.every(watch => !watch.stopped), 'nothing was thrown away')

  session.setVisible(true)
  assert.equal(reader.paused, false)
  assert.equal(recorded.length, opened, 'the same watches listen again; nothing is opened anew')
  assert.deepEqual(shown(), ['ready', 1, 'ready', 2, 'ready', 1])

  session.setVisible(false)
  assert.deepEqual([session.snapshot.status, session.snapshot.items.length], ['idle', 0], 'a channel surface that was left lets go, as before')
  assert.equal(reader.paused, false)
  session.close()
})

test('a channel list read again from the start keeps the open channel asking, and it comes back by itself', () => {
  const session = new ChannelsSession(uid, credentials, () => {})
  session.connection(true)
  session.setVisible(true)
  readList()
  session.posts.open({ requestId: 'r2', channelId: 'ch-a' })
  readPosts()
  assert.equal(session.snapshot.posts?.status, 'ready')
  session.refresh()
  assert.equal(session.snapshot.posts, null, 'the list is being read: no posts are shown from it')
  assert.equal((session.posts as unknown as { value: { requestId: string; status: string } | null }).value?.requestId, 'r2', 'the open screen\'s request is kept')
  readList()
  readPosts()
  assert.equal(session.snapshot.posts?.requestId, 'r2')
  assert.equal(session.snapshot.posts?.status, 'ready', 'the screen that asked once gets its posts again')
  assert.equal(session.snapshot.posts?.posts.length, 2)
  session.close()
})

// Waking the Mac: the window can say it is shown before the screen stops counting as locked. The session takes it,
// reads nothing while locked, and reads once unlocked.
test('a channel surface shown while the screen is locked starts reading once it is unlocked', () => {
  const session = new ChannelsSession(uid, credentials, () => {})
  session.connection(true)
  session.setLocked(true)
  const before = recorded.length
  session.setVisible(true)
  assert.equal(recorded.length, before, 'nothing is read while locked')
  session.setLocked(false)
  assert.ok(recorded.length > before, 'the list is read once unlocked')
  readList()
  assert.equal(session.snapshot.status, 'ready')
  session.close()
})
