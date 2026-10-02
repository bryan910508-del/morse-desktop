import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ChannelComments } from '../../src/main/accounts/channel-comments'
import { channelPostRevision } from '../../src/main/media/channel-post-media-document'
import type { FirestoreReader, ReadCredentials, WatchEvents } from '../../src/main/network/firestore-rpc'
import { documents, ReadFailure, type FirestoreDocument } from '../../src/main/network/firestore-values'

const credentials: ReadCredentials = { signal: new AbortController().signal, authorize: async () => ({ idToken: 'id', appCheckToken: 'check', expiresAt: Date.now() + 3600000 }) }
const at = { seconds: '1790121600', nanos: 0 }
const uid = 'me', root = `${documents}/channels/ch-a`
const post = (id: string): FirestoreDocument => ({ name: `${root}/posts/${id}`, updateTime: at, fields: { channelId: { stringValue: 'ch-a' }, authorId: { stringValue: uid },
  text: { stringValue: id }, visibility: { stringValue: 'public' }, createdAt: { timestampValue: at }, likedBy: { arrayValue: { values: [] } }, likeCount: { integerValue: '0' }, commentCount: { integerValue: '1' } } }) as unknown as FirestoreDocument
const comment = (postId: string, id: string): FirestoreDocument => ({ name: `${root}/posts/${postId}/comments/${id}`, updateTime: at, fields: { channelId: { stringValue: 'ch-a' }, postId: { stringValue: postId },
  authorId: { stringValue: 'other' }, authorName: { stringValue: '다른 사람' }, text: { stringValue: '댓글' }, createdAt: { timestampValue: at } } }) as unknown as FirestoreDocument

// A comments pane opened again shows what it last received for that post at once; with nothing received yet, a first
// read that cannot reach the server says it waits for the connection instead of spinning without a word.
test('comments received earlier show at once, and a first read that cannot connect says so', () => {
  const panes: WatchEvents[] = []
  const reader = { watch: (target: { query?: unknown }, _signal: AbortSignal, events: WatchEvents) => { if (target.query) panes.push(events); return () => {} } } as unknown as FirestoreReader
  const posts = new Map([['p1', post('p1')], ['p2', post('p2')]])
  const comments = new ChannelComments(uid, credentials, request => ({ reader, post: posts.get(request.postId)! }), () => {})
  const request = (selectionId: string, postId: string) => ({ selectionId, requestId: 'r3', channelId: 'ch-a', postId, revision: channelPostRevision(posts.get(postId)!) })
  comments.open(request('s1', 'p1'))
  panes[0]!.snapshot(new Map([[`${root}/posts/p1/comments/c1`, comment('p1', 'c1')]]))
  comments.dismiss('s1')

  comments.open(request('s2', 'p1'))
  assert.equal(comments.snapshot?.status, 'ready', 'shown before any answer')
  assert.equal(comments.snapshot?.items.length, 1)
  panes[1]!.state('loading')
  panes[1]!.state('loading', new ReadFailure('network'))
  assert.equal(comments.snapshot?.items.length, 1, 'a try that failed does not take them away')
  assert.equal(comments.snapshot?.waiting, true)
  panes[1]!.snapshot(new Map())
  assert.deepEqual([comments.snapshot?.status, comments.snapshot?.items.length, comments.snapshot?.waiting], ['ready', 0, false], 'the answer replaces them')

  comments.open(request('s3', 'p2'))
  assert.deepEqual([comments.snapshot?.status, comments.snapshot?.waiting ?? false], ['loading', false])
  panes[2]!.state('loading', new ReadFailure('network'))
  assert.deepEqual([comments.snapshot?.status, comments.snapshot?.waiting], ['loading', true], 'nothing to show: it says it waits for the connection')

  comments.forget()
  comments.open(request('s4', 'p1'))
  assert.equal(comments.snapshot?.status, 'loading', 'a lock forgets them')
  comments.clear()
})
