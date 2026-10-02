import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import { ChannelCommentCreation } from '../../src/main/accounts/channel-comment-creation'
import { executeCommentCreation } from '../../src/main/storage/channel-comment-creation-table'
import { executeCommentDraft } from '../../src/main/storage/channel-comment-drafts'
import { ChannelCommentCreationFailure } from '../../src/main/network/channel-comment-creation-write'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'
import type { CommentCreationRequest } from '../../src/shared/channel-comment-creation'
import type { CommentDraftRecord } from '../../src/shared/channel-comment-drafts'

// A comment on its way goes again by itself, as a post does (channel-post-resend.test.ts), and before it goes again
// it is brought up to date with the post: the count it raises is checked against the post's revision, which a like
// or another comment moves, so the old request would only be refused.
const uid = 'me', channelId = 'ch1', postId = 'p1'
const post = (count: number, seconds: string): FirestoreDocument => ({ name: `${documents}/channels/${channelId}/posts/${postId}`, updateTime: { seconds, nanos: 0 },
  createTime: { seconds: '1790121600', nanos: 0 }, fields: { commentCount: { integerValue: String(count) }, authorId: { stringValue: 'owner' } } }) as unknown as FirestoreDocument

test('a comment whose outcome is unknown goes again under the same id, against the post as it is then', async () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE channel_comment_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE channel_comment_drafts (channel_id TEXT NOT NULL, post_id TEXT NOT NULL, text TEXT NOT NULL, revision TEXT NOT NULL UNIQUE, parent_id TEXT, parent_revision TEXT, PRIMARY KEY(channel_id,post_id));`)
  let current = post(3, '1790121600')
  const writes: CommentCreationRequest[] = []
  const reader = {
    getDocument: async () => null,
    createChannelComment: async (_uid: string, request: CommentCreationRequest) => {
      writes.push(request)
      // The first attempt is cut off; someone liked the post meanwhile, and another comment came in.
      if (writes.length === 1) { current = post(4, '1790121700'); throw new ChannelCommentCreationFailure('unknown') }
    },
    close: () => {}
  }
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const creation = new ChannelCommentCreation(uid, auth, () => {}, () => current, () => ({ authorId: uid, authorName: '나', authorPhotoURL: null, profileVersion: '1:0' }),
    () => '', () => 'scope', async (command, validate) => { validate(); return executeCommentCreation(db, command as never, uid) as never }, () => {}, () => reader as never)
  const read = (): CommentDraftRecord => executeCommentDraft(db, { kind: 'comment-draft-read', target: { channelId, postId } }) as CommentDraftRecord
  const revision = randomUUID()
  executeCommentDraft(db, { kind: 'comment-draft-write', request: { channelId, postId, text: '좋은 글이네요', expected: null, revision } })
  await creation.refresh()
  const id = randomUUID()
  await creation.prepare({ channelId, postId, id, draftRevision: revision, text: '좋은 글이네요' })
  assert.equal(read().text, '', 'the comment holds its own words; the draft is free')
  await creation.action({ id, state: 'prepared', action: 'send' })
  assert.equal(creation.snapshot.pending?.state, 'submitted')
  await new Promise(resolve => setTimeout(resolve, 1300))
  assert.deepEqual(writes.map(request => request.id), [id, id], 'the same comment id went again')
  assert.deepEqual(writes.map(request => request.count), [3, 4], 'and raised the count the post had then')
  assert.equal(creation.snapshot.pending?.state, 'confirmed')
  await creation.close()
})

// Q87 / A1 §3-4: a comment posted once and then deleted must not come back when its id goes again. The server keeps a
// deletion record and its rules refuse the id; the refusal, read with that record from the server, ends the comment
// without an error.
test('a comment the server says was deleted after it was posted ends without an error', async () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE channel_comment_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE channel_comment_drafts (channel_id TEXT NOT NULL, post_id TEXT NOT NULL, text TEXT NOT NULL, revision TEXT NOT NULL UNIQUE, parent_id TEXT, parent_revision TEXT, PRIMARY KEY(channel_id,post_id));`)
  const writes: CommentCreationRequest[] = []
  const reader = {
    getDocument: async (path: string) => path.includes('/deletedComments/') ? { name: path, fields: {} } : null,
    createChannelComment: async (_uid: string, request: CommentCreationRequest) => { writes.push(request); throw new ChannelCommentCreationFailure('refused', 'PERMISSION_DENIED') },
    close: () => {}
  }
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const creation = new ChannelCommentCreation(uid, auth, () => {}, () => post(3, '1790121600'), () => ({ authorId: uid, authorName: '나', authorPhotoURL: null, profileVersion: '1:0' }),
    () => '', () => 'scope', async (command, validate) => { validate(); return executeCommentCreation(db, command as never, uid) as never }, () => {}, () => reader as never)
  const revision = randomUUID()
  executeCommentDraft(db, { kind: 'comment-draft-write', request: { channelId, postId, text: '지워진 댓글', expected: null, revision } })
  await creation.refresh()
  const id = randomUUID()
  await creation.prepare({ channelId, postId, id, draftRevision: revision, text: '지워진 댓글' })
  await creation.action({ id, state: 'prepared', action: 'send' })
  assert.equal(writes.length, 1)
  assert.equal(creation.snapshot.pending?.state, 'confirmed', 'over, not refused')
  const draft = executeCommentDraft(db, { kind: 'comment-draft-read', target: { channelId, postId } }) as CommentDraftRecord
  assert.equal(draft.text, '', 'its words do not come back to the composer')
  await creation.close()
})

// A1 §3-4: a comment whose answer was lost is looked for; not there, it goes again only when the server has no deletion
// record for it or its post. Its post deleted meanwhile (by the owner or an admin) ends it, and nothing is sent again.
// When the record cannot be read, it is neither sent again nor ended.
test('a comment looked for after a lost answer ends when its post was deleted, and waits when the record cannot be read', async () => {
  for (const record of ['post-deleted', 'unreadable'] as const) {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE channel_comment_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
      CREATE TABLE channel_comment_drafts (channel_id TEXT NOT NULL, post_id TEXT NOT NULL, text TEXT NOT NULL, revision TEXT NOT NULL UNIQUE, parent_id TEXT, parent_revision TEXT, PRIMARY KEY(channel_id,post_id));`)
    const writes: CommentCreationRequest[] = []
    const reader = {
      getDocument: async (path: string) => {
        if (path.includes('/deletedPosts/')) { if (record === 'unreadable') throw new Error('offline'); return { name: path, fields: {} } }
        return null
      },
      createChannelComment: async (_uid: string, request: CommentCreationRequest) => { writes.push(request); throw new ChannelCommentCreationFailure('unknown') },
      close: () => {}
    }
    const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
    const creation = new ChannelCommentCreation(uid, auth, () => {}, () => post(3, '1790121600'), () => ({ authorId: uid, authorName: '나', authorPhotoURL: null, profileVersion: '1:0' }),
      () => '', () => 'scope', async (command, validate) => { validate(); return executeCommentCreation(db, command as never, uid) as never }, () => {}, () => reader as never)
    const revision = randomUUID()
    executeCommentDraft(db, { kind: 'comment-draft-write', request: { channelId, postId, text: '늦은 댓글', expected: null, revision } })
    await creation.refresh()
    const id = randomUUID()
    await creation.prepare({ channelId, postId, id, draftRevision: revision, text: '늦은 댓글' })
    await creation.action({ id, state: 'prepared', action: 'send' })
    await new Promise(resolve => setTimeout(resolve, 1300))
    assert.equal(writes.length, 1, `${record}: not sent again`)
    if (record === 'post-deleted') {
      assert.equal(creation.snapshot.pending?.state, 'confirmed', 'over, not failed')
      assert.equal(creation.snapshot.message, '이미 삭제된 댓글이라 다시 올리지 않았습니다.', 'said once, briefly')
    } else assert.equal(creation.snapshot.pending?.state, 'submitted', 'still waiting to be looked at')
    await creation.close()
  }
})
