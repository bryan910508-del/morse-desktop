import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { ChannelPostCreation } from '../../src/main/accounts/channel-post-creation'
import { executePostCreation, executePostPhotos, type PostCreationCommand } from '../../src/main/storage/channel-post-creation-table'
import { executePostDraft } from '../../src/main/storage/channel-post-drafts'
import { ChannelPostCreationFailure } from '../../src/main/network/channel-post-creation-write'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { PendingPostCreation, PostCreationRequest } from '../../src/shared/channel-post-creation'
import type { PostDraftRecord } from '../../src/shared/channel-post-drafts'

// A channel post on its way goes again by itself (user decision 2026-09-29, as Android e8b6b3e): one that never left
// when the connection is back, and one whose outcome is unknown once the server is seen not to have it — under the
// same id, which the write only creates while it is free. Its words leave the draft when it is handed over, so the
// composer is never held by it, and come back if it is not published.
const uid = 'owner1', channelId = 'ch1'
const stamp = { seconds: '1790121600', nanos: 0 }
const channel = { name: `${documents}/channels/${channelId}`, updateTime: stamp, createTime: stamp,
  fields: { name: { stringValue: '채널' }, ownerId: { stringValue: uid }, isPublic: { booleanValue: true } } } as unknown as FirestoreDocument

function harness(write: (request: PostCreationRequest, call: number) => Promise<void>, look: () => Promise<FirestoreDocument | null> = async () => null,
  record: () => Promise<FirestoreDocument | null> = async () => null) {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE channel_post_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE channel_post_photos (photo_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, position INTEGER NOT NULL, source BLOB NOT NULL, session TEXT, uploaded INTEGER NOT NULL DEFAULT 0, UNIQUE(post_id, position));
    CREATE TABLE channel_post_drafts (channel_id TEXT PRIMARY KEY, text TEXT NOT NULL, visibility TEXT NOT NULL, revision TEXT NOT NULL UNIQUE);`)
  const store = async <T>(command: PostCreationCommand, validate: () => void): Promise<T> => {
    validate()
    return (command.kind === 'post-photo-read' || command.kind === 'post-photo-state' ? executePostPhotos(db, command) : executePostCreation(db, command, uid)) as T
  }
  const writes: PostCreationRequest[] = [], looks: number[] = []
  const reader = {
    // The post itself is looked for; its deletion record (A1) is read after it, and not counted as a look.
    getDocument: async (path: string) => path.includes('/deletedPosts/') ? record() : (looks.push(1), look()),
    createChannelPost: async (_uid: string, request: PostCreationRequest) => { writes.push(request); await write(request, writes.length) },
    close: () => {}
  }
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const creation = new ChannelPostCreation(uid, auth, () => {}, () => ({ channel, admin: undefined }), () => 'scope', store, () => {}, () => reader as never)
  const draft = (write?: { text: string; expected: string | null }): PostDraftRecord => write
    ? executePostDraft(db, { kind: 'post-draft-write', request: { channelId, text: write.text, visibility: 'public', expected: write.expected, revision: randomUUID() } }) as PostDraftRecord
    : executePostDraft(db, { kind: 'post-draft-read', target: { channelId } }) as PostDraftRecord
  const pending = (): PendingPostCreation | null => creation.snapshot.pending
  return { creation, draft, pending, writes, looks }
}
async function publish(h: ReturnType<typeof harness>, text: string): Promise<string> {
  const saved = h.draft({ text, expected: h.draft().revision })
  await h.creation.refresh()
  const id = randomUUID()
  await h.creation.prepare({ channelId, text, visibility: 'public', id, draftRevision: saved.revision! })
  await h.creation.action({ id, state: 'prepared', action: 'send' })
  return id
}
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

test('a post whose outcome is unknown, and that the server does not have, goes again under the same id', async () => {
  const h = harness(async (_request, call) => { if (call === 1) throw new ChannelPostCreationFailure('unknown') })
  const id = await publish(h, '안녕하세요')
  assert.equal(h.pending()?.state, 'submitted', 'it waits to be looked for, not for someone to check it')
  // The words left the draft when the post was handed over: the composer is free for the next one.
  assert.equal(h.draft().text, '')
  assert.doesNotThrow(() => h.draft({ text: '다음 글', expected: h.draft().revision }))
  await wait(1300)
  assert.equal(h.looks.length, 1, 'the server was asked for the post once')
  assert.deepEqual(h.writes.map(request => request.id), [id, id], 'it went again under its own id')
  assert.equal(h.pending()?.state, 'confirmed')
  assert.equal(h.draft().text, '다음 글', 'what was written meanwhile is untouched')
  await h.creation.close()
})

test('a post the server already has is not sent again', async () => {
  const h = harness(async () => { throw new ChannelPostCreationFailure('unknown') },
    async () => ({ name: 'x', fields: { authorId: { stringValue: uid }, channelId: { stringValue: channelId } } }) as unknown as FirestoreDocument)
  await publish(h, '한 번만')
  await wait(1300)
  assert.equal(h.writes.length, 1)
  assert.equal(h.pending()?.state, 'confirmed')
  await h.creation.close()
})

test('a post that never left waits as prepared, and goes when the connection is back', async () => {
  const h = harness(async (_request, call) => { if (call === 1) throw new ChannelPostCreationFailure('not-sent') })
  const id = await publish(h, '연결되면')
  assert.equal(h.pending()?.state, 'prepared', 'never shown as a result to look for')
  assert.equal(h.looks.length, 0, 'nothing left, so there is nothing to look for')
  h.creation.pause(); h.creation.resume()
  await wait(50)
  assert.deepEqual(h.writes.map(request => request.id), [id, id])
  assert.equal(h.pending()?.state, 'confirmed')
  await h.creation.close()
})

// The socket never went, only the requests failed to leave; when the network is back (network/reachability.ts) the
// post does not sit out the rest of its wait.
test('a post that never left goes as soon as the network is back, before its wait is over', async () => {
  const h = harness(async (_request, call) => { if (call <= 2) throw new ChannelPostCreationFailure('not-sent') })
  const id = await publish(h, '바로')
  await wait(1300)
  assert.equal(h.writes.length, 2, 'tried twice; the next try is two seconds away')
  h.creation.resume()
  await wait(50)
  assert.deepEqual(h.writes.map(request => request.id), [id, id, id])
  assert.equal(h.pending()?.state, 'confirmed')
  await h.creation.close()
})

test('a post the server refuses gives its words back to the draft', async () => {
  const h = harness(async () => { throw new ChannelPostCreationFailure('refused') })
  await publish(h, '돌려받을 글')
  assert.equal(h.pending()?.state, 'rejected')
  assert.equal(h.draft().text, '돌려받을 글')
  assert.equal(h.writes.length, 1)
  await h.creation.close()
})

test('only the channel conditions of a post may be brought up to date before it goes again', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE channel_post_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE channel_post_photos (photo_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, position INTEGER NOT NULL, source BLOB NOT NULL, session TEXT, uploaded INTEGER NOT NULL DEFAULT 0, UNIQUE(post_id, position));
    CREATE TABLE channel_post_drafts (channel_id TEXT PRIMARY KEY, text TEXT NOT NULL, visibility TEXT NOT NULL, revision TEXT NOT NULL UNIQUE);`)
  const revision = randomUUID(), id = randomUUID()
  executePostDraft(db, { kind: 'post-draft-write', request: { channelId, text: '글', visibility: 'public', expected: null, revision } })
  const request: PostCreationRequest = { channelId, text: '글', visibility: 'public', id, draftRevision: revision, photos: [], authorId: uid, title: '채널',
    channelVersion: '1790121600:0', role: 'owner', adminVersion: null, publicChannel: true, discussionId: null }
  executePostCreation(db, { kind: 'post-creation-prepare', request, photos: [] }, uid)
  const moved = executePostCreation(db, { kind: 'post-creation-rebase', id, expected: 'prepared', request: { ...request, title: '새 이름', channelVersion: '1790121700:0' } }, uid)
  assert.equal(moved?.title, '새 이름')
  assert.throws(() => executePostCreation(db, { kind: 'post-creation-rebase', id, expected: 'prepared', request: { ...request, text: '다른 글' } }, uid), /changed/)
})

// A1 §3-4: a post deleted by another device is not published again under its id — the server keeps a deletion record,
// and a post that is refused or found gone with that record, read from the server, ends without an error and without
// its words coming back. When the record cannot be read, it is neither sent again nor ended.
test('a post deleted elsewhere ends quietly, whether refused or found gone; an unreadable record makes it wait', async () => {
  const deleted = async (): Promise<FirestoreDocument> => ({ name: 'record', fields: {} }) as unknown as FirestoreDocument
  const refused = harness(async () => { throw new ChannelPostCreationFailure('refused') }, async () => null, deleted)
  await publish(refused, '지워진 글')
  assert.equal(refused.pending()?.state, 'confirmed', 'over, not refused')
  assert.equal(refused.creation.snapshot.message, '이미 삭제된 글이라 다시 올리지 않았습니다.')
  assert.equal(refused.draft().text, '', 'its words do not come back to the composer')
  const lost = harness(async () => { throw new ChannelPostCreationFailure('unknown') }, async () => null, deleted)
  await publish(lost, '답을 잃은 글')
  await wait(1300)
  assert.equal(lost.writes.length, 1, 'looked for, found deleted: not sent again')
  assert.equal(lost.pending()?.state, 'confirmed')
  const unreadable = harness(async () => { throw new ChannelPostCreationFailure('unknown') }, async () => null, async () => { throw new Error('offline') })
  await publish(unreadable, '기록을 못 읽은 글')
  await wait(1300)
  assert.equal(unreadable.writes.length, 1, 'not sent again without knowing')
  assert.equal(unreadable.pending()?.state, 'submitted')
  for (const h of [refused, lost, unreadable]) await h.creation.close()
})
