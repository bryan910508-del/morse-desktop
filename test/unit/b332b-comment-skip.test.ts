import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelComments, decodeChannelComments } from '../../src/main/accounts/channel-comments'
import { channelPostRevision } from '../../src/main/media/channel-post-media-document'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, type FirestoreDocument } from '../../src/main/network/firestore-values'

// B332b: a comment that cannot be read is left out on its own and counted; the pane keeps the rest and no error.
const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
const at = { seconds: '1790121600', nanos: 0 }
const uid = 'me', root = `${documents}/channels/ch-a`
const post = (id: string): FirestoreDocument => ({ name: `${root}/posts/${id}`, updateTime: at, fields: { channelId: { stringValue: 'ch-a' }, authorId: { stringValue: uid },
  text: { stringValue: id }, visibility: { stringValue: 'public' }, createdAt: { timestampValue: at }, likedBy: { arrayValue: { values: [] } }, likeCount: { integerValue: '0' }, commentCount: { integerValue: '5' } } }) as unknown as FirestoreDocument
const comment = (id: string, fields: Record<string, unknown> = {}, postId = 'p1'): FirestoreDocument => ({ name: `${root}/posts/p1/comments/${id}`, updateTime: at, fields: {
  channelId: { stringValue: 'ch-a' }, postId: { stringValue: postId }, authorId: { stringValue: 'other' }, authorName: { stringValue: '다른 사람' },
  text: { stringValue: `댓글 ${id}` }, createdAt: { timestampValue: at }, ...fields } }) as unknown as FirestoreDocument
const rows = (): Map<string, FirestoreDocument> => new Map([
  comment('c1'), comment('c2'),
  comment('no-text', { text: undefined }),
  comment('too-long', { text: { stringValue: 'x'.repeat(1001) } }),
  comment('other-post', {}, 'p2')
].map(doc => [doc.name, JSON.parse(JSON.stringify(doc)) as FirestoreDocument]))

test('two readable comments and three that cannot be read give two rows and a count of three', () => {
  const request = { selectionId: 's', requestId: 'r', channelId: 'ch-a', postId: 'p1', revision: '' }
  let counted = 0
  const items = decodeChannelComments(rows().values(), request, uid, count => { counted = count })
  assert.deepEqual(items.map(item => item.id), ['c1', 'c2'])
  assert.equal(counted, 3)
})

test('the comments pane shows the readable comments, with no error, when some cannot be read', () => {
  const panes: WatchEvents[] = []
  const reader = { watch: (target: { query?: unknown }, _signal: AbortSignal, events: WatchEvents) => { if (target.query) panes.push(events); return () => {} } } as unknown as FirestoreReader
  const p1 = post('p1')
  const comments = new ChannelComments(uid, credentials, () => ({ reader, post: p1 }), () => {})
  comments.open({ selectionId: 's1', requestId: 'r1', channelId: 'ch-a', postId: 'p1', revision: channelPostRevision(p1) })
  panes[0]!.snapshot(rows())
  assert.equal(comments.snapshot?.status, 'ready')
  assert.deepEqual(comments.snapshot?.items.map(item => item.id), ['c1', 'c2'])
  // Opened again, the kept comments are shown at once, the unreadable ones still left out.
  comments.dismiss('s1')
  comments.open({ selectionId: 's2', requestId: 'r2', channelId: 'ch-a', postId: 'p1', revision: channelPostRevision(p1) })
  assert.equal(comments.snapshot?.status, 'ready')
  assert.equal(comments.snapshot?.items.length, 2)
})
