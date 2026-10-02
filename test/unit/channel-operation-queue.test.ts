import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { status } from '@grpc/grpc-js'
import { ChannelOperations, channelOperationRetryDelay, type ChannelOperationSession } from '../../src/main/accounts/channel-operations'
import { executeChannelOperation, type ChannelOperationCommand } from '../../src/main/storage/channel-operation-table'
import { ChannelPostLikeFailure } from '../../src/main/network/channel-post-like-write'
import { ChannelPostTextFailure } from '../../src/main/network/channel-post-text-write'
import { ChannelPostRemovalFailure } from '../../src/main/network/channel-post-removal-write'
import { ChannelCommentRemovalFailure } from '../../src/main/network/channel-comment-removal-write'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import { editView, likeView, removedComments, removedPosts, type ChannelOperationItem, type ChannelOperationRequest } from '../../src/shared/channel-operations'

// A like, new words or a delete of a channel post or comment is the device queue's until the server shows it (user
// decision 2026-09-29, Android Q88): read before every send, done when the server already shows it, sent again by
// itself when it does not, and let go quietly when the post is gone.
const uid = 'me1', channelId = 'ch1', postId = 'p1', commentId = 'c1'
const channelPath = `${documents}/channels/${channelId}`, postPath = `${channelPath}/posts/${postId}`, commentPath = `${postPath}/comments/${commentId}`
let clock = 0
const stamp = (): { updateTime: { seconds: string; nanos: number } } => ({ updateTime: { seconds: String(1790121600 + ++clock), nanos: 0 } })
function post(likedBy: string[], text = '처음 글', comments = 0): FirestoreDocument {
  return { name: postPath, ...stamp(), fields: { channelId: { stringValue: channelId }, authorId: { stringValue: uid }, text: { stringValue: text },
    likedBy: { arrayValue: { values: likedBy.map(value => ({ stringValue: value })) } }, likeCount: { integerValue: String(likedBy.length) }, commentCount: { integerValue: String(comments) } } } as unknown as FirestoreDocument
}
const channel = (): FirestoreDocument => ({ name: channelPath, ...stamp(), fields: { ownerId: { stringValue: uid } } }) as unknown as FirestoreDocument
const comment = (): FirestoreDocument => ({ name: commentPath, ...stamp(), fields: { authorId: { stringValue: uid }, text: { stringValue: '댓글' }, channelId: { stringValue: channelId }, postId: { stringValue: postId } } }) as unknown as FirestoreDocument

function database(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE channel_operations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL,
    payload TEXT NOT NULL, state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);`)
  return db
}
// The server as the queue sees it: documents by path, and what each write does (or throws) the time it is called.
interface Server { docs: Map<string, FirestoreDocument>; writes: string[]; next: ((kind: string) => void)[] }
const opened: ChannelOperations[] = []
after(async () => { for (const queue of opened) await queue.close() })
// settleMs: how long a confirmed change stays drawn; 0 here unless a test is about that.
function queue(db: Database.Database, server: Server, settleMs = 0, slow: (kind: string, outcome: string, tryMs: number, totalMs: number) => void = () => {}) {
  const settled: ChannelOperationRequest[] = []
  const answer = (kind: string, apply: () => void): Promise<void> => {
    server.writes.push(kind)
    const failure = server.next.shift()
    if (failure) { try { failure(kind) } catch (error) { return Promise.reject(error) } }
    apply(); return Promise.resolve()
  }
  const session = (): ChannelOperationSession => ({
    read: async path => server.docs.get(path) ?? null,
    like: (request, doc) => answer('like', () => { const members = (doc.fields.likedBy!.arrayValue as { values: { stringValue: string }[] }).values.map(value => value.stringValue)
      server.docs.set(postPath, post(request.desired ? [...members, uid] : members.filter(member => member !== uid), doc.fields.text!.stringValue as string)) }),
    text: (request, doc) => answer('text', () => { server.docs.set(postPath, { ...post([], request.text), fields: { ...doc.fields, text: { stringValue: request.text } } } as FirestoreDocument) }),
    removePost: () => answer('remove-post', () => { server.docs.delete(postPath) }),
    removeComment: () => answer('remove-comment', () => { server.docs.delete(commentPath) }),
    close: () => {}
  })
  const operations = new ChannelOperations(uid, { signal: new AbortController().signal, authorize: async () => ({ idToken: 'i', appCheckToken: 'a', expiresAt: Date.now() + 60000 }) }, () => {},
    async <T>(command: ChannelOperationCommand) => executeChannelOperation(db, command) as T, () => {}, request => settled.push(request), session, settleMs, slow)
  opened.push(operations)
  return { operations, settled }
}
const server = (docs: [string, FirestoreDocument][]): Server => ({ docs: new Map(docs), writes: [], next: [] })
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))
const id = (): string => randomUUID()
const lost = (Failure: new (uncertain: boolean, code?: number) => Error) => () => { throw new Failure(true) }
const swallowed = (Failure: new (uncertain: boolean, code?: number) => Error, apply: () => void) => () => { apply(); throw new Failure(true) }

test('the wait before sending a channel change again grows to a minute', () => {
  assert.deepEqual([1, 2, 3, 6, 7, 20].map(channelOperationRetryDelay), [1000, 2000, 4000, 32000, 60000, 60000])
})

test('a like whose answer was lost is looked for, and sent once only', async () => {
  const s = server([[postPath, post([])]])
  // The write reaches the server; its answer does not come back.
  s.next.push(swallowed(ChannelPostLikeFailure, () => { s.docs.set(postPath, post([uid])) }))
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  assert.deepEqual(q.operations.items().map(item => item.state), ['pending'], 'it waits to be looked at again')
  q.operations.retryNow()
  await wait(30)
  assert.deepEqual(s.writes, ['like'], 'the server already shows it: nothing more is sent')
  assert.deepEqual(q.operations.items(), [])
})

test('a like that never left goes again by itself under the same choice', async () => {
  const s = server([[postPath, post([])]])
  s.next.push(() => { throw new ChannelPostLikeFailure(false) }) // no proof or token: never sent
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(channelOperationRetryDelay(1) + 300)
  assert.deepEqual(s.writes, ['like', 'like'])
  assert.deepEqual(q.operations.items(), [])
  assert.deepEqual((s.docs.get(postPath)!.fields.likedBy!.arrayValue as { values: unknown[] }).values, [{ stringValue: uid }])
})

test('a newer like replaces the one still waiting, and the post ends as it was last left', async () => {
  const s = server([[postPath, post([])]])
  s.next.push(lost(ChannelPostLikeFailure))
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: false })
  assert.deepEqual(q.operations.items().map(item => item.liked), [false], 'one choice waits: the last one')
  q.operations.retryNow()
  await wait(30)
  assert.deepEqual(s.writes, ['like'], 'the server never had the like, and the last choice is «off»: nothing to send')
  assert.deepEqual(q.operations.items(), [])
})

test('someone else changing the post under the write is read again and decided at once', async () => {
  const s = server([[postPath, post([])]])
  s.next.push(() => { s.docs.set(postPath, post(['other'])); throw new ChannelPostLikeFailure(false, status.FAILED_PRECONDITION) })
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  assert.deepEqual(s.writes, ['like', 'like'], 'no wait: the second write is on the post as it is now')
  assert.deepEqual((s.docs.get(postPath)!.fields.likedBy!.arrayValue as { values: { stringValue: string }[] }).values.map(value => value.stringValue), ['other', uid])
})

test('a like for a post that is gone ends quietly, and one the server refuses is kept as failed', async () => {
  const gone = server([])
  const q1 = queue(database(), gone)
  await q1.operations.load()
  await q1.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  assert.deepEqual(q1.operations.items(), [])
  assert.equal(q1.settled.length, 1, 'the screens are told it is over')
  const refusing = server([[postPath, post([])]])
  refusing.next.push(() => { throw new ChannelPostLikeFailure(false, status.PERMISSION_DENIED) })
  const q2 = queue(database(), refusing)
  await q2.operations.load()
  await q2.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  const [failed] = q2.operations.items()
  assert.equal(failed?.state, 'failed')
  assert.ok(failed?.reason)
  assert.equal(refusing.writes.length, 1, 'a refusal is not repeated')
})

test('new words whose answer was lost are found on the server; words written over elsewhere are kept for another try', async () => {
  const s = server([[postPath, post([], '처음 글')]])
  s.next.push(swallowed(ChannelPostTextFailure, () => { s.docs.set(postPath, post([], '고친 글')) }))
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-text', id: id(), channelId, postId, original: '처음 글', text: '고친 글' })
  await wait(30)
  q.operations.retryNow()
  await wait(30)
  assert.deepEqual(s.writes, ['text'])
  assert.deepEqual(q.operations.items(), [])
  // Another device wrote the post meanwhile: those words are not written over, and the typed ones stay.
  s.docs.set(postPath, post([], '다른 기기의 글'))
  await q.operations.enqueue({ kind: 'post-text', id: id(), channelId, postId, original: '고친 글', text: '또 고친 글' })
  await wait(30)
  const [failed] = q.operations.items()
  assert.equal(failed?.state, 'failed')
  assert.equal(failed?.text, '또 고친 글')
  assert.equal(s.docs.get(postPath)!.fields.text!.stringValue, '다른 기기의 글')
})

test('a delete is done once the post or comment is gone, whoever took it away', async () => {
  const s = server([[postPath, post([])], [channelPath, channel()], [commentPath, comment()]])
  s.next.push(swallowed(ChannelPostRemovalFailure, () => { s.docs.delete(postPath) }))
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-delete', id: id(), channelId, postId })
  await wait(30)
  q.operations.retryNow()
  await wait(30)
  assert.deepEqual(s.writes, ['remove-post'], 'looked for, found gone: done')
  assert.deepEqual(q.operations.items(), [])
  const c = server([[postPath, post([], '글', 1)], [commentPath, comment()]])
  c.next.push(lost(ChannelCommentRemovalFailure))
  const q2 = queue(database(), c)
  await q2.operations.load()
  await q2.operations.enqueue({ kind: 'comment-delete', id: id(), channelId, postId, commentId })
  await wait(30)
  c.docs.delete(commentPath) // another device deleted it meanwhile
  q2.operations.retryNow()
  await wait(30)
  assert.deepEqual(c.writes, ['remove-comment'])
  assert.deepEqual(q2.operations.items(), [])
})

// iOS ChannelService.deletePost and Android FirestoreChannelPostDeletes delete a post whatever comments or pictures it
// has; the server then takes away its media, its discussion copy and the count. Who may delete is A1 §3-5 (Telegram,
// telegram-refs R-1/R-2): the owner or a canDeleteMessages admin any post or comment, an author their own.
test('a post with comments and pictures is deleted like any other; the owner deletes anyone\'s', async () => {
  const full = post([], '사진과 댓글이 있는 글', 3)
  full.fields.mediaKeys = { arrayValue: { values: [{ stringValue: 'channel_posts/ch1/photo.jpg' }] } }
  full.fields.mediaTypes = { arrayValue: { values: [{ stringValue: 'image' }] } }
  const s = server([[postPath, full], [channelPath, channel()]])
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-delete', id: id(), channelId, postId })
  await wait(30)
  assert.deepEqual(s.writes, ['remove-post'])
  assert.deepEqual(q.operations.items(), [])
  const theirs = post([])
  theirs.fields.authorId = { stringValue: 'someone' }
  const o = server([[postPath, theirs], [channelPath, channel()]])
  const q2 = queue(database(), o)
  await q2.operations.load()
  await q2.operations.enqueue({ kind: 'post-delete', id: id(), channelId, postId })
  await wait(30)
  assert.deepEqual(o.writes, ['remove-post'], 'the channel\'s owner deletes a post someone else wrote')
})

test('in a channel this account does not own, only a canDeleteMessages admin deletes others\' posts and comments', async () => {
  const theirsPost = (): FirestoreDocument => { const doc = post([], '남의 글', 1); doc.fields.authorId = { stringValue: 'someone' }; return doc }
  const theirsComment = (): FirestoreDocument => { const doc = comment(); doc.fields.authorId = { stringValue: 'someone' }; return doc }
  const bossChannel = (): FirestoreDocument => ({ name: channelPath, ...stamp(), fields: { ownerId: { stringValue: 'boss' } } }) as unknown as FirestoreDocument
  const admin = (canDelete: boolean | null): FirestoreDocument => ({ name: `${channelPath}/admins/${uid}`, ...stamp(),
    fields: { userId: { stringValue: uid }, permissions: { mapValue: { fields: canDelete === null ? {} : { canDeleteMessages: { booleanValue: canDelete } } } } } }) as unknown as FirestoreDocument
  for (const [who, adminDoc, allowed] of [['no admin', null, false], ['admin without the flag', admin(null), false], ['admin with it off', admin(false), false], ['canDeleteMessages admin', admin(true), true]] as const) {
    const docs: [string, FirestoreDocument][] = [[postPath, theirsPost()], [channelPath, bossChannel()], [commentPath, theirsComment()]]
    if (adminDoc) docs.push([`${channelPath}/admins/${uid}`, adminDoc])
    const s = server(docs)
    const q = queue(database(), s)
    await q.operations.load()
    await q.operations.enqueue({ kind: 'comment-delete', id: id(), channelId, postId, commentId })
    await q.operations.enqueue({ kind: 'post-delete', id: id(), channelId, postId })
    await wait(50)
    assert.deepEqual(s.writes, allowed ? ['remove-comment', 'remove-post'] : [], who)
    if (!allowed) assert.deepEqual(q.operations.items().map(item => item.state), ['failed', 'failed'], who)
  }
  // An author deletes their own post in a channel they do not own, admin or not (Morse keeps this, A1 §3-5).
  const own = post([], '내 글', 0)
  const s = server([[postPath, own], [channelPath, bossChannel()]])
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-delete', id: id(), channelId, postId })
  await wait(30)
  assert.deepEqual(s.writes, ['remove-post'])
})

test('a change waiting out its wait holds only its own post', async () => {
  const other = `${channelPath}/posts/p2`
  const s = server([[postPath, post([])], [other, { ...post([]), name: other } as FirestoreDocument]])
  s.next.push(lost(ChannelPostLikeFailure))
  const q = queue(database(), s)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId: 'p2', liked: true })
  await wait(30)
  assert.deepEqual(s.writes, ['like', 'like'], 'the other post went at once')
  assert.deepEqual(q.operations.items().map(item => item.postId), [postId], 'only the first post still waits')
})

test('a change still waiting when the app closes goes after it opens again', async () => {
  const db = database(), s = server([[postPath, post([])]])
  s.next.push(lost(ChannelPostLikeFailure))
  const first = queue(db, s)
  await first.operations.load()
  const change = id()
  await first.operations.enqueue({ kind: 'post-like', id: change, channelId, postId, liked: true })
  await wait(30)
  await first.operations.close()
  const second = queue(db, s)
  await second.operations.load()
  await wait(30)
  assert.deepEqual(s.writes, ['like', 'like'])
  assert.deepEqual(second.operations.items(), [])
})

// The screens' copies of a post come from the server's stream a moment after the write is answered (0.3 s measured on
// this Mac): a confirmed change stays drawn until then, so the heart does not go back to ♡ and a deleted post does not
// come back for that moment (Telegram applies the answer's updates at once: tdesktop Reactions::send).
test('a confirmed like stays drawn until the copy shows it, then goes after its time', async () => {
  const s = server([[postPath, post([])]])
  const q = queue(database(), s, 150)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  assert.deepEqual(s.writes, ['like'])
  assert.deepEqual(q.operations.items().map(item => [item.state, item.liked]), [['settled', true]], 'the write is answered and the change is kept')
  assert.deepEqual(likeView({ selected: false, count: 0 }, q.operations.items(), postId), { selected: true, count: 1 }, 'a copy from before the like still shows ♥')
  assert.deepEqual(likeView({ selected: true, count: 4 }, q.operations.items(), postId), { selected: true, count: 4 }, 'a copy that shows it is drawn as it is')
  await wait(200)
  assert.deepEqual(q.operations.items(), [], 'after its time only the copy counts')
})

test('a newer choice replaces the confirmed one, and a confirmed one can be let go', async () => {
  const s = server([[postPath, post([])]])
  const q = queue(database(), s, 5000)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  s.next.push(lost(ChannelPostLikeFailure))
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: false })
  await wait(30)
  assert.deepEqual(q.operations.items().map(item => [item.state, item.liked]), [['pending', false]], 'only the newer choice is drawn')
  assert.deepEqual(likeView({ selected: true, count: 1 }, q.operations.items(), postId), { selected: false, count: 0 })
  q.operations.retryNow()
  await wait(30)
  const [confirmed] = q.operations.items()
  assert.equal(confirmed?.state, 'settled')
  await q.operations.discard(confirmed!.id)
  assert.deepEqual(q.operations.items(), [])
})

test('a confirmed delete keeps the post and the comment off the screens; a gone or refused change is not kept as done', async () => {
  const s = server([[channelPath, channel()], [postPath, post([], '처음 글', 1)], [commentPath, comment()]])
  const q = queue(database(), s, 5000)
  await q.operations.load()
  await q.operations.enqueue({ kind: 'comment-delete', id: id(), channelId, postId, commentId })
  await q.operations.enqueue({ kind: 'post-delete', id: id(), channelId, postId })
  await wait(50)
  assert.deepEqual(s.writes, ['remove-comment', 'remove-post'])
  assert.deepEqual(q.operations.items().map(item => [item.kind, item.state]), [['comment-delete', 'settled'], ['post-delete', 'settled']])
  assert.deepEqual([...removedPosts(q.operations.items())], [postId])
  assert.deepEqual([...removedComments(q.operations.items(), postId)], [commentId])
  // The post is gone now: a like for it ends quietly, and nothing is drawn for it.
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  assert.equal(q.operations.items().some(item => item.kind === 'post-like'), false)
  // One the server refuses is failed, never confirmed.
  const s2 = server([[postPath, post([])]])
  s2.next.push(() => { throw new ChannelPostLikeFailure(false, status.PERMISSION_DENIED) })
  const q2 = queue(database(), s2, 5000)
  await q2.operations.load()
  await q2.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(30)
  assert.deepEqual(q2.operations.items().map(item => item.state), ['failed'])
  assert.deepEqual(likeView({ selected: false, count: 0 }, q2.operations.items(), postId), { selected: false, count: 0 })
})

test('new words: on their way or refused come before confirmed ones, which are the post\'s words until the copy has them', () => {
  const words = (id: string, state: ChannelOperationItem['state'], text: string): ChannelOperationItem =>
    ({ id, kind: 'post-text', channelId, postId, commentId: null, liked: null, text, state, reason: '', createdAt: 0 })
  assert.equal(editView([words('a', 'settled', '고친 글')], postId)?.text, '고친 글')
  assert.equal(editView([words('b', 'pending', '또 고친 글'), words('a', 'settled', '고친 글')], postId)?.id, 'b')
  assert.equal(editView([words('c', 'failed', '거절된 글'), words('a', 'settled', '고친 글')], postId)?.id, 'c')
  assert.equal(editView([words('a', 'settled', '고친 글')], 'other'), null)
})

// A try over two seconds leaves one line in the connection log: which change and how it ended, how long — no ids.
test('a channel change whose try takes over two seconds is noted, a quick one is not', async () => {
  const s = server([[postPath, post([])]])
  const noted: string[] = []
  const q = queue(database(), s, 0, (kind, outcome, tryMs, totalMs) => noted.push(`${kind} ${outcome} ${tryMs > 2000} ${totalMs >= tryMs}`))
  await q.operations.load()
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: true })
  await wait(50)
  assert.deepEqual(noted, [], 'a quick try says nothing')
  s.next.push(() => { const until = Date.now() + 2100; while (Date.now() < until) { /* a slow answer */ } })
  await q.operations.enqueue({ kind: 'post-like', id: id(), channelId, postId, liked: false })
  await wait(2300)
  assert.deepEqual(noted, ['post-like done true true'])
})
