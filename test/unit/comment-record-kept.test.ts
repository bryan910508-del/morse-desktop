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

// B10 (2026-09-30): a comment whose answer was lost keeps its record until the server says what became of it. The
// connection going, the account's queue closing (a switch, a lock) and opening again leave it as it was; only the
// server's answer ends it. In the Phase1 check the answer was dropped after the write had reached the server, so the
// first look once the connection was back found the comment there and ended the record — that is this test's last step.
const uid = 'me', channelId = 'ch1', postId = 'p1'
const post: FirestoreDocument = { name: `${documents}/channels/${channelId}/posts/${postId}`, updateTime: { seconds: '1790121600', nanos: 0 },
  createTime: { seconds: '1790121600', nanos: 0 }, fields: { commentCount: { integerValue: '3' }, authorId: { stringValue: 'owner' } } } as unknown as FirestoreDocument
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 20))
}

test('a comment whose answer was lost keeps its record through a lost connection and a reopened queue, and ends when the server has it', async () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE channel_comment_creations (id TEXT PRIMARY KEY, payload TEXT, state TEXT NOT NULL);
    CREATE TABLE channel_comment_drafts (channel_id TEXT NOT NULL, post_id TEXT NOT NULL, text TEXT NOT NULL, revision TEXT NOT NULL UNIQUE, parent_id TEXT, parent_revision TEXT, PRIMARY KEY(channel_id,post_id));`)
  let online = true, written = false
  const writes: CommentCreationRequest[] = []
  const reader = {
    getDocument: async (path: string) => {
      if (!online) throw new Error('offline')
      return written && path.includes('/comments/') ? { name: path, fields: { authorId: { stringValue: uid } } } : null
    },
    // The write reaches the server; its answer does not come back.
    createChannelComment: async (_uid: string, request: CommentCreationRequest) => { writes.push(request); written = true; online = false; throw new ChannelCommentCreationFailure('unknown') },
    close: () => {}
  }
  const auth = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 60000 }) }
  const queue = (): ChannelCommentCreation => new ChannelCommentCreation(uid, auth, () => {}, () => post, () => ({ authorId: uid, authorName: '나', authorPhotoURL: null, profileVersion: '1:0' }),
    () => '', () => 'scope', async (command, validate) => { validate(); return executeCommentCreation(db, command as never, uid) as never }, () => {}, () => reader as never)
  const revision = randomUUID()
  executeCommentDraft(db, { kind: 'comment-draft-write', request: { channelId, postId, text: '답을 잃은 댓글', expected: null, revision } })
  const first = queue()
  await first.refresh()
  const id = randomUUID()
  await first.prepare({ channelId, postId, id, draftRevision: revision, text: '답을 잃은 댓글' })
  await first.action({ id, state: 'prepared', action: 'send' })
  assert.equal(first.snapshot.pending?.state, 'submitted')
  first.pause()
  assert.equal(first.snapshot.pending?.state, 'submitted', 'the connection going leaves it')
  await first.close()

  const second = queue()
  await second.refresh()
  assert.equal(second.snapshot.pending?.id, id)
  assert.equal(second.snapshot.pending?.state, 'submitted', 'a queue opened again reads it back as it was')
  await until(() => !second.snapshot.busy)
  assert.equal(second.snapshot.pending?.state, 'submitted', 'a look that cannot reach the server does not end it')

  online = true
  second.resume()
  await until(() => second.snapshot.pending?.state === 'confirmed')
  assert.equal(second.snapshot.pending?.state, 'confirmed', 'the server has it: over')
  assert.equal(writes.length, 1, 'and it was not sent again')
  await second.close()
})
